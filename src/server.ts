import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";
import { getRouter } from "./router";
import { startInstance } from "./start";

export default createStartHandler({
  createRouter: getRouter,
  startInstance,
})(defaultStreamHandler);
