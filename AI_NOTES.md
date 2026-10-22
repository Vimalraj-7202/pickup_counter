# AI notes

I used Cursor for this assignment. I pasted the brief and asked it to build the backend first, then the React screen, with one behavior in each file so I can find the right place in the interview. Cursor wrote most of the Express API, the Postgres schema, the concurrency tests, the customer screen, and the README. I decided the late-payment rule, ran the app, and checked the tests against a real database.

A prompt that worked was the full brief plus this instruction: keep each behavior in its own file, store money as integer paise, and compute the countdown from `expiresInSeconds` and a monotonic clock, not the PC clock. That kept the hold, the webhook, and the pickup claim separate, which is the code I expect to be asked to change live.

One thing it got wrong: it put a rupee sign in a comment in `backend/src/sql/seed.sql`. The local Postgres on this Windows machine uses WIN1252, and that character has no equivalent there. The API process failed while seeding and never printed that it was listening. I noticed because startup stopped with an encoding error (`0xe2 0x82 0xb9` has no equivalent in WIN1252). I changed the comment to plain text, "45 rupees", and the API started.
