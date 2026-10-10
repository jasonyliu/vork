# Deployment Manual: {environment} — {project title}

<!-- Canonical location: main/docs/deployments/deploy_<environment>/<environment>.md per PROJECT.md §Deployments — one manual per environment, written entirely from the project's own specifics. The manual is the Primary Specification of every Deployment Stage Task targeting this environment (DELIVERY.md §Deployment) and must make the deployment executable without prior context. Scripts and tooling it invokes live under main/provisions/, referenced from the relevant section. -->

## Environment

{what this environment is and serves — its concrete instances: hosts, URLs, deploy targets, and the consumers that read from it (PROJECT.md §Environments)}

## When

{the moment this deployment is performed, and what cues it}

## Mechanism

{the deploy acts in order — the repository state deployed (tag, branch tip) and how it is designated; what to run, what to wait for, and the signals that confirm each act}

## Smoke

{how the deployed result is verified live against this environment — the checks and their expected outcomes}

## Rollback

{how this environment returns to its previous stable state when an attempt fails}

## Record

{what record an invocation produces and where it lives — from none to one per invocation; a failed attempt's reason is recorded in the Task's transition comment, and here when this section requires a record (DELIVERY.md §Deployment)}
