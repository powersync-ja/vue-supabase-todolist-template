// src/plugins/powersync.ts
import { PowerSyncDatabase } from "@powersync/web";
import { AppSchema } from "../library/AppSchema.ts";
import { createPowerSyncPlugin } from "@powersync/vue";

export const powerSync = new PowerSyncDatabase({
  database: {
    dbFilename: "vue-todo.db",
  },
  schema: AppSchema,
});

export const powerSyncPlugin = createPowerSyncPlugin({ database: powerSync });
