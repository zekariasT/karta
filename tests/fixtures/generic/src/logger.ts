import { add } from "./util.js";

export function log(prefix: string, n: number) {
  console.log(prefix, add(n, 1));
}
