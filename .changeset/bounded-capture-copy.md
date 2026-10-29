---
"node-or-bun": patch
---

Copy only the retained capture prefix within the 4 MiB limit and avoid copying chunks after overflow while continuing to drain and validate the stream.
