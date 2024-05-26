import { createApp } from "vue";
import { createAppRouter } from "./plugins/router";
import App from "./App.vue";
import "./style.css";

const app = createApp(App);
const router = createAppRouter();

app.use(router);
app.mount("#app");
