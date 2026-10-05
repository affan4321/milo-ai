import { microsoftIdentity, MSA_TENANT } from "./auth-rules";
let fails = 0; const check = (c: unknown, m: string) => { if (!c) { fails++; console.error("FAIL:", m); } };
check((microsoftIdentity({ email: " Ada@Corp.com ", xms_edov: true, name: "Ada" }) as any).email === "ada@corp.com", "verified work account accepted, email normalised");
check((microsoftIdentity({ preferred_username: "bob@outlook.com", tid: MSA_TENANT }) as any).email === "bob@outlook.com", "personal Microsoft account accepted (falls back to preferred_username)");
check("error" in microsoftIdentity({ email: "ceo@victim-corp.com", tid: "some-attacker-tenant" }), "an attacker's tenant claiming someone else's email is REJECTED (the nOAuth takeover)");
check("error" in microsoftIdentity({ email: "ceo@victim-corp.com", xms_edov: false }) && "error" in microsoftIdentity({ email: "ceo@victim-corp.com", xms_edov: "0" }), "explicitly unverified is rejected");
check("error" in microsoftIdentity({ xms_edov: true }) && "error" in microsoftIdentity({ email: "not-an-email", xms_edov: true }) && "error" in microsoftIdentity({ email: 5 as any, xms_edov: true }), "missing or malformed email is rejected");
console.log(fails ? `${fails} FAILED` : "ok"); process.exit(fails ? 1 : 0);
