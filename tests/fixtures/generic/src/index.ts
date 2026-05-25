import { Service } from "./service.js";
import { add } from "./util.js";

const svc = new Service();
svc.do(add(1, 2));
