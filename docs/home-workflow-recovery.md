# Home form recovery

A saved browser workflow request must not prevent entering a new mandate. The description stays editable after a failed request or page reload. Editing it, or selecting **Start a new mandate**, clears only the browser retry identity. Previously submitted server work is not cancelled. Retrying without editing still uses the exact original request body and ID.

Regression verification: two tests failed before the fix (read-only restored field and missing new-mandate action). All 40 related component/request tests then passed, along with TypeScript and scoped ESLint. A real authenticated isolated browser restored a synthetic `acquire.pending-workflow.v1` session marker, reloaded Home, and successfully filled the description. That removed the marker and restored the ordinary form controls without submitting a workflow.

To repeat the browser check, set that session-storage key to a valid synthetic request identity, reload Home, and type into the description. Confirm it is editable, the marker disappears, and the submit button changes from **Retry workflow** to **Find companies**. Do not submit the form merely to test typing. Separately, the component regression confirms an unedited retry preserves its original identity, while a genuinely new submission uses a new one.
