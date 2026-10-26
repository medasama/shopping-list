// Supabase同期版の保存処理。config.js の storage が 'supabase' のときだけ読み込まれる。
// index.html 側の items / removingIds / justAddedId / render / showToast を使う。
const SUPABASE_URL = APP_CONFIG.supabaseUrl;
const SUPABASE_KEY = APP_CONFIG.supabaseKey;
const TABLE = APP_CONFIG.table || 'shopping_items';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

async function loadItems(){
  const { data, error } = await sb
    .from(TABLE)
    .select('*')
    .eq('checked', false)
    .order('created_at', { ascending: false });
  if(error){
    console.error('loadItems failed', error);
    return null;
  }
  return data;
}

// 削除した品目のID。再取得やRealtimeの遅れた通知で復活しないよう、一定時間は無視する
const TOMBSTONE_MS = 30000;
const tombstones = new Map();
function markDeleted(id){ tombstones.set(id, Date.now() + TOMBSTONE_MS); }
function unmarkDeleted(id){ tombstones.delete(id); }
function isDeleted(id){
  const exp = tombstones.get(id);
  if(exp === undefined) return false;
  if(exp < Date.now()){ tombstones.delete(id); return false; }
  return true;
}

let pendingAdds = 0;
let pendingEdits = 0;
let addEpoch = 0; // 追加の開始・完了ごとに進める。再同期中に動いたら古い結果とみなす

// 保存に成功したら true。失敗時は呼び出し側で入力内容を戻す。
async function addItem(name, category){
  if(!name.trim()) return true;
  pendingAdds++;
  addEpoch++;
  let result;
  try{
    result = await sb
      .from(TABLE)
      .insert({ name: name.trim(), category: category || '食品', checked: false })
      .select()
      .single();
  }catch(e){
    result = { error: e };
  }finally{
    pendingAdds--;
    addEpoch++;
  }
  const { data, error } = result;
  if(error || !data){
    console.error('addItem failed', error);
    showToast('追加できませんでした。通信を確認してもう一度試してね');
    return false;
  }
  justAddedId = data.id;
  if(!items.find(i => i.id === data.id)){
    items.unshift(data);
  }
  render();
  return true;
}

async function completeItem(id){
  if(removingIds.has(id)) return;
  const it = items.find(i => i.id === id);
  if(!it) return;
  removingIds.add(id);
  markDeleted(id);
  render();
  // DB削除とアニメーション(500ms)を並行して待ち、DB削除に成功したときだけ画面から外す
  const [delResult] = await Promise.all([
    sb.from(TABLE).delete().eq('id', id).then(r => r, e => ({ error: e })),
    new Promise(resolve => setTimeout(resolve, 500))
  ]);
  removingIds.delete(id);
  if(delResult.error){
    console.error('completeItem delete failed', delResult.error);
    unmarkDeleted(id);
    showToast('通信に失敗したので、最新の状態を確認します');
    await recoverAfterFailure(it);
    return;
  }
  items = items.filter(i => i.id !== id);
  render();
}

function restoreItem(it){
  if(!items.find(i => i.id === it.id)){
    items.push(it);
    items.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  }
  render();
}

// 削除失敗時: 応答だけ失敗してサーバーでは削除済みのこともあるため、
// 勝手に戻さずサーバーの状態に合わせる。取得できないときだけ画面に戻す。
async function recoverAfterFailure(it){
  const ok = await resyncItems();
  if(!ok && it) restoreItem(it);
  else render();
}

async function changeCategory(id, newCategory){
  const it = items.find(i => i.id === id);
  if(!it || it.category === newCategory) return;
  it.category = newCategory;
  render();
  const catEl = listEl.querySelector(`li[data-id="${id}"] .item-cat`);
  if(catEl){
    catEl.classList.add('cat-pulse');
    catEl.addEventListener('animationend', ()=> catEl.classList.remove('cat-pulse'), { once:true });
  }
  pendingEdits++;
  let error;
  try{
    ({ error } = await sb.from(TABLE).update({ category: newCategory }).eq('id', id));
  }catch(e){
    error = e;
  }finally{
    pendingEdits--;
  }
  if(error){
    console.error('changeCategory failed', error);
    resyncItems();
  }
}

async function deleteItem(id){
  const it = items.find(i => i.id === id);
  items = items.filter(i => i.id !== id);
  removingIds.delete(id);
  markDeleted(id);
  render();
  const { error } = await sb.from(TABLE).delete().eq('id', id).then(r => r, e => ({ error: e }));
  if(error){
    console.error('deleteItem failed', error);
    unmarkDeleted(id);
    showToast('通信に失敗したので、最新の状態を確認します');
    await recoverAfterFailure(it);
  }
}

let realtimeChannel = null;

let reconnectTimer = null;
let reconnectDelay = 1000;

function scheduleReconnect(){
  if(reconnectTimer) return;
  reconnectTimer = setTimeout(()=>{
    reconnectTimer = null;
    subscribeRealtime();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, 30000);
}

function subscribeRealtime(){
  if(realtimeChannel){
    // 自分で閉じる際に届く CLOSED で再接続が連鎖しないよう、先に参照を外す
    const old = realtimeChannel;
    realtimeChannel = null;
    sb.removeChannel(old);
  }
  const channel = sb.channel('shopping_items_changes');
  realtimeChannel = channel;
  channel
    .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, (payload)=>{
      if(payload.eventType === 'INSERT'){
        const row = payload.new;
        if(!row.checked && !isDeleted(row.id) && !items.find(i => i.id === row.id)){
          items.unshift(row);
          render();
        }
      } else if(payload.eventType === 'UPDATE'){
        const row = payload.new;
        if(isDeleted(row.id)) return;
        const idx = items.findIndex(i => i.id === row.id);
        if(row.checked){
          if(idx !== -1 && !removingIds.has(row.id)){
            removingIds.add(row.id);
            render();
            setTimeout(()=>{
              items = items.filter(i => i.id !== row.id);
              removingIds.delete(row.id);
              render();
            }, 500);
          }
        } else if(idx !== -1){
          items[idx] = row;
          render();
        }
      } else if(payload.eventType === 'DELETE'){
        const oldId = payload.old.id;
        // 自分の完了アニメーション中は、その処理側で画面から外す
        if(!removingIds.has(oldId)){
          items = items.filter(i => i.id !== oldId);
          render();
        }
      }
    })
    .subscribe((status)=>{
      // 古いチャンネル(自分で閉じたもの)からの通知は無視する
      if(channel !== realtimeChannel) return;
      if(status === 'SUBSCRIBED'){
        reconnectDelay = 1000;
      } else if(status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED'){
        // 接続が切れた間の変更を取りこぼしている可能性があるため、
        // 再購読とあわせて最新状態を取り直す。
        resyncItems();
        scheduleReconnect();
      }
    });
}

let resyncSeq = 0;

async function resyncItems(){
  const seq = ++resyncSeq;
  const epoch = addEpoch;
  const fresh = await loadItems();
  // 取得失敗、より新しい再同期がある、追加と重なった場合は上書きしない
  if(fresh === null) return false;
  if(seq !== resyncSeq || epoch !== addEpoch || pendingAdds > 0 || pendingEdits > 0) return true;
  const pending = items.filter(i => removingIds.has(i.id));
  const freshRows = fresh.filter(i => !isDeleted(i.id));
  const freshIds = new Set(freshRows.map(i => i.id));
  items = freshRows.concat(pending.filter(i => !freshIds.has(i.id)));
  render();
  return true;
}

// 起動後に呼ぶ。復帰・定期取得・Realtime で最新状態に合わせ続ける。
function startSync(){
  subscribeRealtime();
  // バックグラウンドから復帰した際、その間の追加・削除の取りこぼしがないよう再同期する
  document.addEventListener('visibilitychange', ()=>{
    if(document.visibilityState === 'visible'){
      resyncItems();
    }
  });
  // Realtimeの接続は通知なしに切れることがあるため、定期取得と復帰イベントで補う
  const POLL_MS = 25000;
  setInterval(()=>{
    if(document.visibilityState === 'visible') resyncItems();
  }, POLL_MS);
  window.addEventListener('online', ()=>{ resyncItems(); subscribeRealtime(); });
  window.addEventListener('focus', ()=> resyncItems());
  window.addEventListener('pageshow', (e)=>{
    if(e.persisted) resyncItems();
  });
}
