// Pure classification of diagnostic facts; never a publication decision.
export function classifyPage(f){
  if([403,429,503].includes(f.status)||f.challenge) return 'ACCESS_CHALLENGE';
  if(f.status!==200) return 'HTTP_FAILURE';
  if(!f.expectedDestination) return 'WRONG_DESTINATION';
  if(f.signIn) return 'SIGN_IN_WALL';
  if(f.genericError) return 'GENERIC_ERROR';
  if(f.productTitleNodes>0 && f.productTitleLength>0) return 'READABLE_PRODUCT';
  return 'UNKNOWN_RESPONSE';
}
export function summarizeHealth(samples){
  const first=samples[0],last=samples.at(-1);
  if(!last) return {outcome:'NO_EVIDENCE',lateProductTitle:false};
  return {outcome:classifyPage(last),lateProductTitle:classifyPage(first)!=='READABLE_PRODUCT'&&classifyPage(last)==='READABLE_PRODUCT',
    titleSelectorMismatch:last.productTitleNodes>0 && last.spanProductTitleNodes===0};
}
