import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";

const startHandler = createStartHandler(defaultStreamHandler);

export default {
  fetch(request: Request) {
    return startHandler(request);
  },
};
