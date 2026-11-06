---
"node-or-bun": patch
---

Deduplicate adapter-neutral spawn-environment copying, terminal-proof waiting, and cleanup-failure aggregation, and remove a redundant Bun close wrapper. Strengthen Node/Bun conformance for inherited environments, undefined cleanup rejections, and already-exited test cleanup without changing the public process contract.
