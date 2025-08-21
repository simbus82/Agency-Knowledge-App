// Date annotator: extract simple date patterns (dd/mm/yyyy, yyyy-mm-dd, month names IT)
module.exports.annotateDates = function annotateDates(chunks){
  const monthRe = /(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)/gi;
  return chunks.map(c => {
    const dates = [];
    const text = c.text || '';
    const iso = text.match(/\b\d{4}-\d{2}-\d{2}\b/g) || [];
    iso.forEach(v=>dates.push({ raw:v, norm:v }));
    const euro = text.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g) || [];
    euro.forEach(v=>{
      const parts = v.split('/');
      if(parts[2]){
        const yyyy = parts[2].length===2 ? '20'+parts[2] : parts[2];
        const mm = parts[1].padStart(2,'0');
        const dd = parts[0].padStart(2,'0');
        dates.push({ raw:v, norm:`${yyyy}-${mm}-${dd}` });
      }
    });
    const names = text.match(monthRe) || [];
    names.forEach(v=>dates.push({ raw:v, norm:null }));
    return { ...c, dates };
  });
};
