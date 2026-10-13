1. end-to-end processing flow covers the whole thing correctly, but the separation between wake request and async worker is not obvious
2. Stage 1 needs to focus on taking in the request, validate data, normalize data to WakeQueueItem, verify eligibility including dependency readiness, lifecycle and audit status check, then store it. As Task goes through lifecycle and audit status, multiple request will arrive, we need to handle updating existing entries too, generate necessary event log, that is it. From here on in later stages only refer to WakeQueueItem, the web requests end here, REST web facing interfaces takes in the request process the data then store it, end of story. The storage takes over the ownership of the WakeQueueItem. Those that are not eligible items get dropped, generate event log, that means if we have a task that still has unfinished sub tasks, we are not even going to queue it, just wait for next webhook call from Github, as far as I know any Task change will receive a webhook call to this REST web service, that means only the very last request with task's all subtasks cleared and resolved gets queue into storage. You need to stop treating the request beyond this point, once they are normalized and stored, they become an abstration of an data entity of the local system, call it a wake, and request_id is not enough to ensure idempotency, it is not even needed for storage, it represent the request that delivered the data, it is not part of the wake, I believe a combination of project_id + task_id is a good candidate of the identifier of a wake, since we want the assignee to work on one task in one dedicated session at a time, the session will be created prior work begin with lable that matches the project name or id, so these two parts will uniquely identify a target routing for task execution, considering we can change assignee of a task at anytime, we do not invovle assignee information to form the wake.id.
3. Stage 2 needs to focus on the Async dispath control, it doesn't work with web requests, don't even mention it, technically it doesn't even have the awareness of a REST web request exist, its data come from the WakeQueueItem storage, the postgres queue or whatever the surface that stores it. It is job is the read the next WakeQueueItem, priority and ordering of tasks need to be defined, determine its routing according to assignee and project, then check lease availablility of targeted agent. By the end of stage 2, you will have a WakeQueueItem and accompany decision at hand read for next stage. Generate event logs. We do not need the path of notifying me or anyone else if a WakeQueueItem is routed with a correct agent, that means we are either we have no agent setup or the upstream made a mistake, just mark the WakeQueueItem to be Unrouted, these will be stored in the system until further actions taken, of cause we need event log to record these, so that we can debug the live system.
4. Stage 3 depends on the WakeQueueItem delivered from stage 2, focuing on Runtime dispatch will prepare the OpenClaw wake action accordingly, send dispatch through OpenClaw adapter. Don't create any session, I don't want to give it that authorith yet, before we are comfortable with the MVP, I don't want to risk accidentally generate millions of sessions. It is job primarily is to resolve the downstream target then dispatch messages to OpenClaw agents. Generate event logs too.
5. I see you have superseded wakery-decision-engine.md, next time move it to an separate folder for reading clarity.
6. as for wakery-contracts, I will clean that up with the following:
a. WakeRequest: 
Keep these:
request_id - for obvious reasons
source - string enum as source identifier
project_id - yes
task_id - just call it task id, remember once the request is taken into the system, it is a wake, no longer a tasks, we are abstracting the concept of a wake up call, not just a task, a task is part of information the call carries.
task_type - what kind of task type.
task_title - some meta data is useful for later debugging
task_priority - for sorting and ordering
task_status - task lifecycle status, gets updated along task lifecycle
task_audit - task security auditing status, gets updated along task audit
task_payload - an arbitrary bag for others thing we might want to use that is not primarily concerning routing and wakening agents for work.
assignee_id - this first-class data required for routing, dont call it a hint, if this missing, the whole thing won't work, so an ID is must
assignee_name - in case id is not available
timestamp - WakeRequest arrival time, not request_at, if we ever need to record a specifiy time of a system event, always call it timestamp, use unix timestamp with precision to mill seconds, no real engineer will call a time of when a request arrives request_at, that sounds so amateur.
Drop these:
trigger_kind - drop it, it covers the same as source.
route_hint - we do not need that, at least not for now. And it is a terrible name for a field
dependency_ready_hint -  what is with the `_hint` subfix, wtf.
not_before - no need.

b. WakeResponse
Unless we are required by the sender of these request, just keep it simple for now
request_id - yes
status - yes
message - for sementic communication

drop the rest.

c. WakeQueueItem -> let's call it wake, shorter and add abit of life in it

id - mint unique local wake occurrence id
task_key - md5(project_id + task_id)
state_key - md5(project_id + task_id + task_status + task_audit)
project_id - mapped from request
task_id - mapped from request
task_title - mapped from request
task_priority - mapped from request
task_status - mapped from request
task_audit - mapped from request
task_payload - mapped from request
assignee_id - mapped from request
assignee_name - mapped from request
attemps - total dispatch attempts
status - wake process status enum: queued (ready for routing), parked (missing routing path), deferred (agent is busy), dispathed (routed and message sent), completed (When task has gone through full lifecycle and finally become completed.), deleted (data entries soft delete). I dont think we need these: Leased (Didn't see when will this happens), escalated (no escalation in this MVP), 
create_time - timestamp of entry creation
update_time - timestamp of when entry was last updated

e. RouteConfig --> route: each route needs to be uniquely identified by project_id + task_type or project_id alone, where project_id + task_id has high precedence.   

id - the id of a route
project_id - project id
task_type - route is bound with task type
assignee_id - assignee id
assignee_name - assignee name
session_key - corresponding session key
agent_id - agent id
agent_name - agent name
delivery - routing delivery mode: session (delivery_mode = existing_session) | run (delivery_mode = spawn_session & spawn_mode = run), thread is always default to true. we do not need to control it separately.
max_run - maxium in flight concurrency in run mode.
status - data entry status: active, disabled, deleted
create_time - timestamp of entry creation
update_time - timestamp of when entry was last updated

drop:
spawn_mode - drop it too, combine with delivery_mode in to deliver field.
thread - not gonna suport this in first MVP

d. AssigneeLease --> wake_route_lease : a connecting entity that record current lease between wake and route, I do not want auto expire, at least not yet. As a new wake request arrives, stage 1 needs to check if any currently active WakeRouteLease should be marked as completed, that is if a task has entry in WakeRouteLease that is currently in active, and recorded wake_task_status carries different value of which it is receive now, that means the task has moved on to another lifecycle status. You may make the rules more tight.

id - the lease id
route_id - related route id
wake_id - related wake id
wake_task_status - the related wake task status when this entry was created, use this in comparison when new wake request arrives to determine whether we should mark a lease complete.
status - lease status: active, completed, deleted
create_time - timestamp of entry creation
update_time - timestamp of when entry was last updated

e. DispatchDecision + WakeEvent + DispatchReceipt -> Event: I believe these all belong to event, they may represent different type of events, but still they are all signals emitted from the system to record a particular event. I have turned this into a Event definition entity rather than defining any specific event, we are not going to store actually event logs in DB that will explode DB real quick, events are captured in jsonl form or any other text based log form, we will read these simply by inspecting the log file content, unless we are going to use events to trigger downstream functionalities, we will not collect these into a storage that provide searchability and manipulation features. System will emit event in json format, and fields such as event_id, event_name, request_id, task_id, etc will be part of that json payload. Which means you need a separte spec to write the event fields that are supported currently.

id - identifier
code - numerical code, make a list of all currently support event code in appendix
name - sementic name.
type - enum of event type, `wakery`, `system`, we can extend to other types as system grow bigger and more complex
severity - enum of debug, info, warn, error
create_time - timestamp of entry creation
update_time - timestamp of when entry was last updated

The above stages with my description are strictly modularized, you need to rigoriously follow that style, think the code while writing the spec, you want the end product to map as closely to these modules as possible. I see you are mixing the Wake ingress API contracts and Data Entity contracts together in spec_wakery-contracts.md, separate them with clear title, one for router-ingress-api, one for data-entity, as they are not going to be implemented on same surface.

The events, github-adapter and runtime_adapter (change this to openclaw_adapter) are good separation of specs, keep them that way, I will give them thorough read once you make changes to the above.