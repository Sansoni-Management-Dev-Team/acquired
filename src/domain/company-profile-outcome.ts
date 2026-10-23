export type CompanyProfileOutcome={ok:boolean;matched?:boolean;saved?:boolean;identityReviewRequired?:boolean;skipped?:boolean};
/** Old checkpoint receipts without saved retain their original interpretation. */
export function companyProfileDisposition(result:CompanyProfileOutcome):'saved'|'review'|'skipped'|'failed'{
 if(!result.ok)return'failed';
 if(result.saved!==false){if(result.identityReviewRequired||result.skipped)throw Error('Conflicting company profile outcome');return'saved';}
 if(Boolean(result.identityReviewRequired)===Boolean(result.skipped))throw Error('Unsaved company profile requires an explicit disposition');
 return result.identityReviewRequired?'review':'skipped';
}
