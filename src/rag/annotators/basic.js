// Basic annotator (placeholder). Adds naive labels based on simple semantic cues.
module.exports.annotateBasic = function annotateBasic(chunks){
  return chunks.map(c => {
    const text = (c.text||'').toLowerCase();
    const labels = [];
    if(/non si puo|non si può|vietat|non consentit/.test(text)) labels.push('prohibition');
    if(/si puo|si può|consentit/.test(text)) labels.push('permission');
    if(/claim|posso dire|è un|e' un|puo dire/.test(text)) labels.push('claim_statement');
    if(/hypermix|rimos|prodotto|cliente|project|task/.test(text)) labels.push('entity_ref');
    return { ...c, labels };
  });
};
