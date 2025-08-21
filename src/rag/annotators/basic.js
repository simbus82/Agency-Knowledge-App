// Basic annotator (placeholder). Adds naive labels based on simple semantic cues.
module.exports.annotateBasic = function annotateBasic(chunks){
  return chunks.map(c => {
    const text = (c.text||'').toLowerCase();
    const labels = [...(c.labels||[])];
    if(/hypermix|rimos|prodotto|cliente|project|task/.test(text) && !labels.includes('entity_ref')) labels.push('entity_ref');
    return { ...c, labels };
  });
};
