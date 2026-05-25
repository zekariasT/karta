import { add } from "./util.js";
import { log } from "./logger.js";

export class Service {
  do(n: number) {
    log("service", add(n, 2));
  }
}
