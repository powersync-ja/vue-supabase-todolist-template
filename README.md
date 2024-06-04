# Vue Tutorial: Building an Offline-First ToDo App with Supabase and PowerSync

Crafting an offline-first Vue app ensures seamless user experiences by leveraging a local in-app database. This tutorial will guide you through the process of constructing an offline-first ToDo app using Vue, Supabase, and PowerSync. You can expect to allocate approximately 30 to 45 minutes to complete this tutorial.

![image](./img/flow.png)

## Prerequisites

Before diving in, ensure you have active accounts with both Supabase and PowerSync. If you haven't signed up yet, you can initiate your journey with PowerSync for free [here](https://accounts.journeyapps.com/portal/free-trial?powersync=true&__hstc=156206116.8d466f99b6f735f148d11d10c8ec3b93.1714389194534.1714415338564.1714976498368.4&__hssc=156206116.1.1714976498368&__hsfp=3997489276), and with Supabase [here](https://supabase.com/dashboard/sign-in?). Additionally, make sure you have Vue set up on your system.

We will cover the following steps:

1. Set up a Supabase project and publication to PowerSync.
2. Configure PowerSync.
3. Set up the Vue Project.
4. Integrate PowerSync.
5. Test the offline-first functionality.

## 1. Set Up a Supabase Project and Publication to PowerSync

### 1.1. Create a New Supabase Project

1. Navigate to the Supabase dashboard.
2. Create a new project.
3. Remember to **save the password** the database password as it will be required later.
4. Wait for the project to be created.
5. For easier testing, in your Supabase dashboard, go to Authentication > Providers > Email > Toggle Confirm Email. This will remove the need to verify test user email addresses.
   ![image](./img/remove-verify.png)

### 1.2. Create Tables for the ToDo App

Navigate to the SQL editor and execute the following SQL query to create the tables:

```sql
create table public.todos (
  id uuid not null default gen_random_uuid(),
  created_at timestamp with time zone not null default now(),
  description text not null,
  completed boolean not null default false,
  constraint todos_pkey primary key (id)
) tablespace pg_default;
```

### 1.3. Add Tables to the Publication

```sql
create publication powersync for table public.todos
```

## 2. Configuring PowerSync

### 2.1. Connect PowerSync to Your Supabase

1. **Create a New Instance:**

   - Navigate to the PowerSync dashboard Project tree.
   - Click on "Create new instance".
     ![image](./img/create-instance.png)
   - Provide a name for your instance, e.g., "Supabase Testing".

2. **Adjust Cloud Region (Optional):**

   - Under the "General" tab, modify the cloud region if needed (e.g., from US to EU or JP).

3. **Set Up Database Connection:**

   - In the "DB Connections" tab, click on the + icon.

4. **Retrieve Connection Details from Supabase:**

   - In your Supabase dashboard, navigate to "Project Settings" -> "Database" -> "Connection string" and select the "URI" tab.
   - Uncheck the "Display connection pooler" checkbox.
     ![image](./img/connection-string.avif)
   - Copy the connection string. The hostname should be db.<PROJECT-ID>.supabase.co, and not, for example, aws-0-us-west-1.pooler.supabase.com
   - Paste it into the PowerSync Instance URI field.
   - Enter the password that you saved earlier - the one you used to create the database

5. **Test Connection:**

   - Click "Test Connection" and resolve any errors.

6. **Client Auth:**

   - Under the "Client Auth" tab, enable "Use Supabase Auth".

7. **Save Changes:**
   - Click "Save and Deploy".

### 2.2. Set Up Sync Rules

Sync Rules empower developers to manage data synchronization to user devices, employing a SQL-like syntax within a YAML file. The rules are deployed to the PowerSync instance, ensuring that the data is synchronized correctly. In this tutorial, we will use a simple sync rule to synchronize the ToDo app data.

1. Open the **sync-rules.yaml** file.
2. Replace its contents with the following:

```yaml
# Sync Rules docs: https://docs.powersync.com/usage/sync-rules
bucket_definitions:
  global:
    data:
      # Sync all todos
      - SELECT * FROM todos
```

![image](./img/sync-rules.png)

3. Click **"Validate sync rules"** to ensure the syntax is correct.
4. In the top right corner, click **"Deploy sync rules"** and select the instance you created earlier.
5. Confirm in the dialog and wait for the deployment to complete.

## 3. Set Up the Vue Project

Download this repository and navigate to the project directory. Run the following command to install the required dependencies:

```bash
pnpm install
```

Also install `vite-plugin-wasm` and `vite-plugin-top-level-await` for the WebAssembly and top-level await support and `js-logger` for logging:

```bash
pnpm install vite-plugin-wasm vite-plugin-top-level-await js-logger
```

Add `.env.local` file in the root directory and add the following environment variables:

You will find the `supabase url` and `anon key` in the supabase dashboard under the project settings > API.

The `powersync url` can be found in the PowerSync dashboard by right-clicking on the instance and selecting "Edit instance". The URL is displayed in the "General" tab.

```bash
VITE_SUPABASE_URL=https://<your-supabase-url>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-supabase-anon-key>
VITE_POWERSYNC_URL=https://<your-powersync-url>.journeyapps.com
```

Start the development server:

```bash
pnpm dev
```

Quit the development server by pressing `Ctrl + C`

## 4. Integrate PowerSync & Supabase

Install the Supabase client library:

```bash
pnpm install @supabase/supabase-js
```

### 4.1. Create a Supabase Connector

In the folder named `library` in the `src` directory and create a file named `SupabaseConnector.ts`.

```typescript
import {
  AbstractPowerSyncDatabase,
  BaseObserver,
  CrudEntry,
  PowerSyncBackendConnector,
  UpdateType,
} from "@powersync/web";

import { Session, SupabaseClient, createClient } from "@supabase/supabase-js";

export type SupabaseConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  powersyncUrl: string;
};

/// Postgres Response codes that we cannot recover from by retrying.
const FATAL_RESPONSE_CODES = [
  // Class 22 — Data Exception
  // Examples include data type mismatch.
  new RegExp("^22...$"),
  // Class 23 — Integrity Constraint Violation.
  // Examples include NOT NULL, FOREIGN KEY and UNIQUE violations.
  new RegExp("^23...$"),
  // INSUFFICIENT PRIVILEGE - typically a row-level security violation
  new RegExp("^42501$"),
];

export type SupabaseConnectorListener = {
  initialized: () => void;
  sessionStarted: (session: Session) => void;
};

export class SupabaseConnector
  extends BaseObserver<SupabaseConnectorListener>
  implements PowerSyncBackendConnector
{
  readonly client: SupabaseClient;
  readonly config: SupabaseConfig;

  ready: boolean;

  currentSession: Session | null;

  constructor() {
    super();
    this.config = {
      supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
      powersyncUrl: import.meta.env.VITE_POWERSYNC_URL,
      supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    };

    this.client = createClient(
      this.config.supabaseUrl,
      this.config.supabaseAnonKey,
      {
        auth: {
          persistSession: true,
        },
      }
    );
    this.currentSession = null;
    this.ready = false;
  }

  async init() {
    if (this.ready) {
      return;
    }

    const sessionResponse = await this.client.auth.getSession();
    this.updateSession(sessionResponse.data.session);

    this.ready = true;
    this.iterateListeners((cb) => cb.initialized?.());
  }

  async login(username: string, password: string) {
    const {
      data: { session },
      error,
    } = await this.client.auth.signInWithPassword({
      email: username,
      password: password,
    });

    if (error) {
      throw error;
    }

    this.updateSession(session);
  }

  async fetchCredentials() {
    const {
      data: { session },
      error,
    } = await this.client.auth.getSession();

    if (!session || error) {
      throw new Error(`Could not fetch Supabase credentials: ${error}`);
    }

    console.debug("session expires at", session.expires_at);

    return {
      endpoint: this.config.powersyncUrl,
      token: session.access_token ?? "",
      expiresAt: session.expires_at
        ? new Date(session.expires_at * 1000)
        : undefined,
    };
  }

  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const transaction = await database.getNextCrudTransaction();

    if (!transaction) {
      return;
    }

    let lastOp: CrudEntry | null = null;
    try {
      // Note: If transactional consistency is important, use database functions
      // or edge functions to process the entire transaction in a single call.
      for (const op of transaction.crud) {
        lastOp = op;
        const table = this.client.from(op.table);
        let result: any;
        switch (op.op) {
          case UpdateType.PUT:
            const record = { ...op.opData, id: op.id };
            result = await table.upsert(record);
            break;
          case UpdateType.PATCH:
            result = await table.update(op.opData).eq("id", op.id);
            break;
          case UpdateType.DELETE:
            result = await table.delete().eq("id", op.id);
            break;
        }

        if (result.error) {
          console.error(result.error);
          throw new Error(
            `Could not update Supabase. Received error: ${result.error.message}`
          );
        }
      }

      await transaction.complete();
    } catch (ex: any) {
      console.debug(ex);
      if (
        typeof ex.code == "string" &&
        FATAL_RESPONSE_CODES.some((regex) => regex.test(ex.code))
      ) {
        /**
         * Instead of blocking the queue with these errors,
         * discard the (rest of the) transaction.
         *
         * Note that these errors typically indicate a bug in the application.
         * If protecting against data loss is important, save the failing records
         * elsewhere instead of discarding, and/or notify the user.
         */
        console.error(`Data upload error - discarding ${lastOp}`, ex);
        await transaction.complete();
      } else {
        // Error may be retryable - e.g. network error or temporary server error.
        // Throwing an error here causes this call to be retried after a delay.
        throw ex;
      }
    }
  }

  updateSession(session: Session | null) {
    this.currentSession = session;
    if (!session) {
      return;
    }
    this.iterateListeners((cb) => cb.sessionStarted?.(session));
  }
}
```

### 4.2. Create a Supabase Plugin

In the folder named `plugins` in the `src` directory and create a file named `supabase.ts`.

```typescript
// src/plugins/supabase.ts
import { SupabaseConnector } from "../library/SupabaseConnector";

export const supabase = new SupabaseConnector();
```

### 4.3. Install the PowerSync SDK and Vue Wrapper

```bash
pnpm install @powersync/web @powersync/vue @journeyapps/wa-sqlite
```

### 4.4. Create a PowerSync Vue Plugin

In the folder named `plugins` in the `src` directory and create a file named `powersync.ts`.

```typescript
// src/plugins/powersync.ts
import { AppSchema } from "../library/AppSchema.ts";
import { WASQLitePowerSyncDatabaseOpenFactory } from "@powersync/web";
import { createPowerSyncPlugin } from "@powersync/vue";

export const powerSync = new WASQLitePowerSyncDatabaseOpenFactory({
  dbFilename: "vue-todo.db",
  schema: AppSchema,
}).getInstance();

export const powerSyncPlugin = createPowerSyncPlugin({ database: powerSync });
```

### 4.5. Create a PowerSync Database Schema

In the folder named `library` in the `src` directory and create a file named `AppSchema.ts`.

```typescript
// src/library/AppSchema.ts
// the id column is automatically added to all tables so you don't need to define it here
import { column, Schema, TableV2 } from "@powersync/web";

export const TODOS_TABLE = "todos";

const todos = new TableV2({
  created_at: column.text,
  description: column.text,
  completed: column.integer,
});

export const AppSchema = new Schema({
  todos,
});

export type Database = (typeof AppSchema)["types"];
export type TodoRecord = Database["todos"];
```

### 4.6. Initialize PowerSync

In your `main.ts` file, set up app-wide accessibility of PowerSync composables.

```typescript
// main.ts
import { createApp } from "vue";
import { createAppRouter } from "./plugins/router";
import App from "./App.vue";
import "./style.css";
import { powerSyncPlugin } from "./plugins/powersync";

const app = createApp(App);
const router = createAppRouter();

app.use(router);
app.use(powerSyncPlugin);
app.mount("#app");
```

### 4.7. Update the App.vue File to Initialize PowerSync and Supabase

Update the `App.vue` file to initialize PowerSync and Supabase when the app is mounted.

```vue
<script setup lang="ts">
import { onMounted } from "vue";
import Logger from "js-logger";
import { powerSync } from "./plugins/powersync";
import { supabase } from "./plugins/supabase";

Logger.useDefaults();
Logger.setLevel(Logger.DEBUG);

onMounted(async () => {
  await powerSync.init();
  await powerSync.connect(supabase);
  await supabase.init();
});
</script>

<template>
  <router-view />
</template>
```

### 4.7. Update the TodoList.vue File

Update the `TodoList.vue` file to use the PowerSync SDK for managing todos.
Replace the script section with the following code:

As you can see, we've defined a type for the Todo item and updated the methods to interact with the PowerSync database.

- The `usePowerSync` composable is used to access the PowerSync instance. The `execute` method is used to execute SQL queries,
- The `useQuery` composable is used to have a live view of a certain SQL query from the database, if the underlying data changes the query will automatically re-execute. It's stored in the `todos` ref.
- The `newTodo` ref is used to store the text of the new todo.
- The `todos` ref is automatically updated after adding, updating, or removing todos from the database.
- The `addTodo`, `updateTodo`, and `removeTodo` methods are used to add, update, and remove todos from the database, respectively.
- The `useRouter` composable is used to navigate between routes. If the user is not logged in, they are redirected to the login page.

```typescript
// TodoList.vue
<script setup lang="ts">
import { ref } from "vue";
import { usePowerSync, useQuery } from "@powersync/vue";
import { TodoRecord } from "../library/AppSchema";
import { supabase } from "../plugins/supabase";
import { useRouter } from "vue-router";

const powersync = usePowerSync();
const router = useRouter();
if (!supabase.ready) {
  supabase.registerListener({
    initialized: () => {
      /**
       * Redirect if on the entry view
       */
      if (supabase.currentSession) {
        router.push("/");
      } else {
        router.push("/login");
      }
    },
  });
} else {
  router.push("/");
}

// Define a type for the Todo item
type Todo = TodoRecord;

const newTodo = ref<string>("");
const { data: todos } = useQuery<Todo>("SELECT * from todos");

const addTodo = async () => {
  if (newTodo.value.trim()) {
    await powersync.value.execute(
      "INSERT INTO todos (id, created_at, description, completed) VALUES (uuid(), datetime(), ?, ?) RETURNING *",
      [newTodo.value, 0]
    );
    newTodo.value = "";
  }
};

const updateTodo = async (index: number) => {
  const todo = todos.value[index];
  await powersync.value.execute("UPDATE todos SET completed = ? WHERE id = ?", [
    !todo.completed,
    todo.id,
  ]);
};

const removeTodo = async (index: number) => {
  const todo = todos.value[index];
  await powersync.value.execute("DELETE FROM todos WHERE id = ?", [todo.id]);
};
</script>

```

### 4.8. Go to Login.vue and Register.vue and uncomment the commented code and code blocks

In the `Login.vue` and `Register.vue` files, uncomment the code blocks that handle the login and registration logic.

### 4.9. Update the Vite Config

Update the `vite.config.ts` file to include the following configuration:

```typescript
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { fileURLToPath, URL } from "node:url";

export default defineConfig(({ command }) => {
  const isDev = command === "serve";

  return {
    plugins: [vue(), wasm(), topLevelAwait()],
    define: { "process.env": {} },
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
      extensions: [".js", ".json", ".jsx", ".mjs", ".ts", ".tsx", ".vue"],
    },
    optimizeDeps: {
      // Don't optimize these packages as they contain web workers and WASM files.
      // https://github.com/vitejs/vite/issues/11672#issuecomment-1415820673
      exclude: ["@journeyapps/wa-sqlite", "@powersync/web"],
      include: [
        "@powersync/web > uuid",
        "@powersync/web > event-iterator",
        "@powersync/web > js-logger",
        "@powersync/web > lodash/throttle",
        "@powersync/web > can-ndjson-stream",
        "@powersync/web > bson",
        "@powersync/web > buffer",
        "@powersync/web > rsocket-core",
        "@powersync/web > rsocket-websocket-client",
        "@powersync/web > cross-fetch",
      ],
    },
    worker: {
      format: "es",
      plugins: () => [wasm(), topLevelAwait()],
    },
    build: {
      sourcemap: !isDev, // Disable sourcemaps in development
    },
  };
});
```

## 5. Test the Offline-First Functionality

After setting up everything, you can test the offline-first functionality by disconnecting your device from the internet and ensuring that the ToDo app continues to work seamlessly.

1. Build the app

```bash
pnpm build
```

2. Serve the app

```bash
pnpm serve
```

1. Open `localhost:5173` in your browser you will be redirect to the login page. Click on register a new account and then use the credentials to login.
2. Add a new todo and then disconnect your device from the internet.
3. Add, update, or remove todos while offline.
4. Reconnect to the internet and observe the synchronization of the todos.
5. Verify that the todos are synchronized and shown in the supabase dashboard.

Congratulations! You have successfully built an offline-first ToDo app using Vue, Supabase, and PowerSync.
