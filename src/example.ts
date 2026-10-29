import { InfraiClient } from "./infrai.ts";
import { proveEducatorDomain } from "./domain-ownership.ts";

const key = process.env.INFRAI_API_KEY;
if (!key) throw new Error("Set INFRAI_API_KEY before running the example");

const request = process.argv[2]
  ? JSON.parse(process.argv[2])
  : {
      email: process.env.INFRAI_EMAIL,
      domain: process.env.INFRAI_DOMAIN,
      challenge: process.env.INFRAI_CHALLENGE,
      courseId: process.env.INFRAI_COURSE_ID,
      learnerDeadline: process.env.INFRAI_LEARNER_DEADLINE
    };

const result = await proveEducatorDomain({
  ...request
}, new InfraiClient(key));
console.log(JSON.stringify(result, null, 2));
