/** Safe, provider-neutral failures. Unknown outcomes must retain reservations. */
export type AiFailureCategory='authentication'|'credits'|'rate_limit'|'unsupported_request'|'timeout'|'transport'|'invalid_json'|'incomplete_response'|'usage_invalid'|'schema_validation'|'cancelled'|'unknown';
export type AiRejection={httpStatus:400|401|403|404|422|429;category:'invalid_request'|'authentication_or_policy'|'model_unavailable'|'credits'|'rate_limit';code:'invalid_json_schema'|'invalid_api_key'|'model_not_found'|'unsupported_parameter'|'unsupported_value'|'other';parameter:'response_format'|'response_format.json_schema'|'reasoning_effort'|'model'|'max_completion_tokens'|'other'};
export class AiCompletionError extends Error {
 constructor(readonly category:AiFailureCategory,readonly outcome:'rejected'|'unknown'|'response'='unknown',readonly rejection?:AiRejection){super(`AI request failed (${category}); review the saved attempt before retrying.`);this.name='AiCompletionError';}
}
