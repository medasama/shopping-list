// 端末内保存版の保存処理。config.js の storage が 'supabase' 以外のときに読み込まれる。
// 外部には接続しない。index.html 側の items / removingIds / justAddedId / render を使う。
const STORAGE_KEY = 'shopping_items';

function readAll(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  }catch(err){
    console.error('readAll failed', err);
    return [];
  }
}

function writeAll(all){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

function loadItems(){
  return readAll()
    .filter(i => !i.checked)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// index.html の呼び出し側は Promise<boolean>（保存できたか）を期待する
async function addItem(name, category){
  if(!name.trim()) return true;
  const all = readAll();
  const newItem = {
    id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
    name: name.trim(),
    category: category || '食品',
    checked: false,
    created_at: new Date().toISOString()
  };
  all.unshift(newItem);
  writeAll(all);
  justAddedId = newItem.id;
  items.unshift(newItem);
  render();
  return true;
}

function completeItem(id){
  if(removingIds.has(id)) return;
  const it = items.find(i => i.id === id);
  if(!it) return;
  removingIds.add(id);
  render();
  const all = readAll();
  const idx = all.findIndex(i => i.id === id);
  if(idx !== -1){ all[idx].checked = true; writeAll(all); }
  setTimeout(()=>{
    writeAll(readAll().filter(i => i.id !== id));
    items = items.filter(i => i.id !== id);
    removingIds.delete(id);
    render();
  }, 500);
}

function changeCategory(id, newCategory){
  const it = items.find(i => i.id === id);
  if(!it || it.category === newCategory) return;
  it.category = newCategory;
  render();
  const catEl = listEl.querySelector(`li[data-id="${id}"] .item-cat`);
  if(catEl){
    catEl.classList.add('cat-pulse');
    catEl.addEventListener('animationend', ()=> catEl.classList.remove('cat-pulse'), { once:true });
  }
  const all = readAll();
  const idx = all.findIndex(i => i.id === id);
  if(idx !== -1){ all[idx].category = newCategory; writeAll(all); }
}

function deleteItem(id){
  items = items.filter(i => i.id !== id);
  removingIds.delete(id);
  render();
  writeAll(readAll().filter(i => i.id !== id));
}

// 端末内保存では、同期するものがない
function startSync(){}
