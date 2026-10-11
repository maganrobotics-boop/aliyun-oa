# Course project student identity

Students confirm their name and student number before choosing a main project. The server enforces the existing one-project-per-semester quota, opens the corresponding chapter, and forwards both fields to the designated teacher in the native OA item. Identity is student-provided, with authenticated login email as the account boundary. Previously saved identity can be reused next semester after confirmation.

Apply this overlay to the verified course-projects-20261011-v2 production baseline. Stage in an isolated directory and deploy OA before Chat. For an earlier production baseline, use the archived module snapshots in the v1 and v2 patch directories before applying v3. Keep source and target release directories separate.
