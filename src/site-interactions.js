async function api(url, input) {
  let response, data;
  try {
    response = await fetch(url, {credentials: 'same-origin', signal: AbortSignal.timeout(15000), ...(input ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(input)} : {})});
    data = await response.json();
  } catch {throw new Error('网络连接暂时不可用，请稍后重试。');}
  if (!response.ok) throw new Error(data.error || '服务暂时不可用。');
  return data;
}
async function trackVisit() {
  const metrics = document.querySelector('[data-site-metrics]');
  if (metrics) metrics.querySelector('[data-metrics-status]').textContent = '正在读取访问数据…';
  try {
    const data = await api('/api/metrics', {page: document.body.dataset.pageId, event: crypto.randomUUID()});
    if (metrics) {
      for (const period of ['today', 'total']) for (const kind of ['pv', 'uv']) {
        metrics.querySelector(`[data-metric="${period}-${kind}"]`).textContent = data[period][kind].toLocaleString('zh-CN');
      }
      metrics.querySelector('[data-metrics-status]').textContent = `今日按 UTC+8 统计 · ${data.day}`;
    }
  } catch {
    if (metrics) metrics.querySelector('[data-metrics-status]').textContent = '访问数据暂时不可用，稍后刷新可重试。';
  }
}
async function setupFeedback() {
  const section = document.querySelector('[data-feedback-course]');
  if (!section) return;
  const url = `/api/feedback/${encodeURIComponent(section.dataset.feedbackCourse)}`;
  const status = section.querySelector('[data-feedback-status]');
  status.textContent = '正在读取课程反馈…';
  const form = section.querySelector('form');
  const fieldset = form.querySelector('fieldset');
  const reactions = [...section.querySelectorAll('[data-reaction]')];
  let mine = null;
  let pendingComment = null;
  function busy(value, submittingComment = false) {
    section.setAttribute('aria-busy', String(value));
    section.querySelectorAll('button').forEach(button => {button.disabled = value;});
    if (submittingComment) fieldset.disabled = value;
  }
  function render(data) {
    mine = data.mine;
    reactions.forEach(button => {
      const kind = button.dataset.reaction;
      button.setAttribute('aria-pressed', String(mine === kind));
      button.querySelector('span').textContent = data.reactions[kind].toLocaleString('zh-CN');
    });
    const list = section.querySelector('[data-comments]'); list.replaceChildren();
    if (!data.comments.length) {
      const empty = document.createElement('li'); empty.className = 'empty-comments'; empty.textContent = '还没有留言。可以说说哪里有用、哪里需要改进。'; list.append(empty);
    }
    for (const comment of data.comments) {
      const item = document.createElement('li');
      const heading = document.createElement('div'); heading.className = 'comment-heading';
      const name = document.createElement('strong'); name.textContent = comment.name || '匿名同事';
      const time = document.createElement('time'); time.dateTime = comment.created_at;
      time.textContent = new Date(comment.created_at).toLocaleString('zh-CN', {dateStyle: 'short', timeStyle: 'short'});
      const text = document.createElement('p'); text.textContent = comment.body;
      heading.append(name, time); item.append(heading, text); list.append(item);
    }
  }
  reactions.forEach(button => button.addEventListener('click', async () => {
    busy(true); status.textContent = '正在保存…';
    try {
      render(await api(url, {action: 'reaction', kind: mine === button.dataset.reaction ? null : button.dataset.reaction}));
      status.textContent = mine ? '已保存，再点一次可取消。' : '已取消。';
    } catch (error) {status.textContent = error.message;}
    finally {busy(false);}
  }));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const input = Object.fromEntries(new FormData(form));
    const draft = JSON.stringify(input);
    if (pendingComment?.draft !== draft) pendingComment = {draft, event: crypto.randomUUID()};
    busy(true, true); status.textContent = '正在提交…';
    try {render(await api(url, {action: 'comment', ...input, event: pendingComment.event})); form.reset(); pendingComment = null; status.textContent = '留言已发布，谢谢你的反馈。';}
    catch (error) {status.textContent = error.message;}
    finally {busy(false, true);}
  });
  try {render(await api(url)); busy(false); status.textContent = '无需登录，欢迎点赞、拍砖或留言。';}
  catch {status.textContent = '反馈暂时无法加载，稍后刷新可重试。';}
}
// Establish the shared anonymous cookie before loading the reaction widget.
await trackVisit();
await setupFeedback();
