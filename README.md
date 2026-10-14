# Process Runtime

Reusable captured-command execution for Node.js and Bun.

This repository currently contains the planning and worker-admission baseline.
The implementation will arrive through a reviewed pull request before publication.

The intended package is `@agent-teams/process-runtime`. It owns a narrow process
contract, explicit runtime adapters, and shared behavior conformance. Product Hosts
retain authorization, sandbox policy, process-group or Job Object custody, and
recovery. Desktop windows, UI bridges, PTYs, supervision, and retries are outside
this package's scope.

Engineering Foundation is the first planned consumer. Other consumers migrate
separately. A future Electron main process may use the Node adapter.
