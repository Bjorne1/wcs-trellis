# Infra and Cross-Layer Contract Template

Read this for changes to command/API signatures, cross-layer payloads, database schemas or migrations, and infrastructure integrations such as storage, queues, caches, secrets, or environment wiring.

All seven sections are required. Fill them with verified behavior; name a section's non-applicability explicitly rather than inventing a contract or test.

```markdown
## Scenario: <name>

### 1. Scope / Trigger
- The change or user action that reaches this contract.
- The package and boundary that own it.

### 2. Signatures
- Exact command, API, or database signature.

### 3. Contracts
- Request fields: name, type, constraints.
- Response fields: name, type, constraints.
- Environment keys: required/optional and interpretation.
- Cross-boundary transformations and compatibility behavior.

### 4. Validation & Error Matrix
| Condition | Result or error | Observable state |
| --- | --- | --- |
| <condition> | <error or success> | <effect> |

### 5. Good/Base/Bad Cases
- Good: successful representative case.
- Base: minimal valid case.
- Bad: invalid input or failure at the relevant boundary.

### 6. Tests Required
- Unit/integration/end-to-end boundary and exact assertion points.
- Relevant existing tests or commands, with verification evidence.

### 7. Wrong vs Correct
#### Wrong
<concrete example of the failure pattern>

#### Correct
<concrete example satisfying the contract>
```

Check signatures, validation ordering, persisted effects, and examples against the actual implementation. A lint pass cannot establish runtime boundary behavior.
