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
  const form = section.querySelector('form');
  const reactions = [...section.querySelectorAll('[data-reaction]')];
  const list = section.querySelector('[data-comments]');
  let mine = null, pendingComment = null, activeTarget = null;
  const threads = new Map(), drafts = new Map(), pendingReplies = new Map();
  const replyForm = document.createElement('form');
  replyForm.className = 'comment-form reply-form';
  replyForm.id = 'reply-editor'; replyForm.hidden = true;
  // Only constant markup goes through innerHTML; all user text uses textContent.
  replyForm.innerHTML = `<fieldset><legend>回复 <span data-reply-target></span></legend>
    <label for="reply-body">回复内容 <span>必填 · 最多 1000 字</span></label>
    <textarea id="reply-body" name="body" required maxlength="1000" rows="3" placeholder="接着这条留言聊聊你的看法。"></textarea>
    <div class="comment-optional"><div><label for="reply-name">称呼 <span>选填 · 会公开</span></label><input id="reply-name" name="name" maxlength="40" placeholder="昵称即可" autocomplete="nickname"></div>
    <div><label for="reply-contact">联系方式 <span>选填 · 仅讲师可见</span></label><input id="reply-contact" name="contact" maxlength="200" placeholder="邮箱、微信或其他方便联系的方式" autocomplete="off"></div></div>
    <p class="contact-note">回复和称呼会公开。选填联系方式只为方便讲师联系你，不会展示在页面上。</p>
    <div class="reply-actions"><button type="submit">发布回复</button><button type="button" class="reply-cancel">取消</button></div></fieldset>
    <p class="feedback-status" data-reply-status role="status"></p>`;
  section.append(replyForm);
  const replyStatus = replyForm.querySelector('[data-reply-status]');
  function busy(value) {
    section.setAttribute('aria-busy', String(value));
    section.querySelectorAll('button').forEach(button => {button.disabled = value;});
    form.querySelector('fieldset').disabled = value;
    replyForm.querySelector('fieldset').disabled = value;
  }
  function ordered(rows) {
    return rows.sort((a, b) => a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }
  function merge(previous, incoming) {
    return ordered([...new Map([...previous, ...incoming].map(row => [row.id, row])).values()]);
  }
  function messageNode(message) {
    const item = document.createElement('li');
    const heading = document.createElement('div'); heading.className = 'comment-heading';
    const name = document.createElement('strong'); name.textContent = message.name || '匿名同事';
    const time = document.createElement('time'); time.dateTime = message.created_at;
    time.textContent = new Date(message.created_at).toLocaleString('zh-CN', {dateStyle: 'short', timeStyle: 'short'});
    const body = document.createElement('p'); body.textContent = message.body;
    heading.append(name, time); item.append(heading, body);
    return item;
  }
  function saveDraft() {
    if (activeTarget) drafts.set(activeTarget.id, Object.fromEntries(new FormData(replyForm)));
  }
  function closeReply() {
    saveDraft(); activeTarget = null; replyForm.hidden = true; section.append(replyForm);
    list.querySelectorAll('.comment-reply-button').forEach(button => button.setAttribute('aria-expanded', 'false'));
  }
  function openReply(comment, item, button) {
    saveDraft(); activeTarget = comment;
    replyForm.reset(); replyStatus.textContent = '';
    const draft = drafts.get(comment.id) || {name: form.elements.name.value};
    for (const [key, value] of Object.entries(draft)) replyForm.elements[key].value = value;
    replyForm.querySelector('[data-reply-target]').textContent = comment.name || '匿名同事';
    replyForm.hidden = false; item.append(replyForm);
    list.querySelectorAll('.comment-reply-button').forEach(link => link.setAttribute('aria-expanded', String(link === button)));
    replyForm.querySelector('textarea').focus();
    replyForm.scrollIntoView({block: 'nearest'});
  }
  replyForm.querySelector('.reply-cancel').addEventListener('click', closeReply);
  function renderThread(comment, item) {
    const thread = threads.get(comment.id);
    const old = item.querySelector('.comment-thread'); if (old) old.remove();
    if (!thread?.replies.length) return;
    const discussion = document.createElement('div'); discussion.className = 'comment-thread';
    const title = document.createElement('p'); title.className = 'thread-title'; title.textContent = `${comment.reply_count} 条回复`;
    const replies = document.createElement('ul'); replies.className = 'reply-list'; replies.setAttribute('aria-label', `${comment.name || '匿名同事'}的留言回复`);
    for (const row of thread.replies) replies.append(messageNode(row));
    discussion.append(title);
    if (thread.hasMore) {
      const more = document.createElement('button'); more.type = 'button'; more.className = 'reply-more'; more.textContent = '查看更早回复';
      more.addEventListener('click', async () => {
        busy(true); status.textContent = '正在读取更早回复…';
        try {
          const page = await api(url + '?' + new URLSearchParams({thread: comment.id, before: thread.before}));
          threads.set(comment.id, {replies: merge(thread.replies, page.replies), hasMore: page.has_more_replies, before: page.reply_before});
          renderThread(comment, item); status.textContent = '更早回复已展开。';
        } catch (error) {status.textContent = error.message;}
        finally {busy(false);}
      });
      discussion.append(more);
    }
    discussion.append(replies);
    const button = item.querySelector('.comment-reply-button'); button.after(discussion);
  }
  function render(data) {
    mine = data.mine;
    reactions.forEach(button => {
      const kind = button.dataset.reaction;
      button.setAttribute('aria-pressed', String(mine === kind));
      button.querySelector('span').textContent = data.reactions[kind].toLocaleString('zh-CN');
    });
    list.replaceChildren();
    if (!data.comments.length) {
      const empty = document.createElement('li'); empty.className = 'empty-comments'; empty.textContent = '还没有留言。可以说说哪里有用、哪里需要改进。'; list.append(empty);
    }
    let attached = false;
    for (const comment of data.comments) {
      // A fresh preview may not overlap earlier cached pages. Restart pagination
      // from that preview so replies added between snapshots cannot be skipped.
      const replies = ordered([...(comment.replies || [])]);
      threads.set(comment.id, {replies, hasMore: comment.has_more_replies, before: comment.reply_before});
      const item = messageNode(comment); item.dataset.commentId = comment.id;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'comment-reply-button'; button.textContent = '回复';
      button.setAttribute('aria-controls', 'reply-editor'); button.setAttribute('aria-expanded', String(activeTarget?.id === comment.id));
      button.addEventListener('click', () => openReply(comment, item, button)); item.append(button);
      renderThread(comment, item); list.append(item);
      if (activeTarget?.id === comment.id) {item.append(replyForm); attached = true;}
    }
    if (activeTarget && !attached) section.append(replyForm);
  }
  reactions.forEach(button => button.addEventListener('click', async () => {
    busy(true); status.textContent = '正在保存…';
    try {render(await api(url, {action: 'reaction', kind: mine === button.dataset.reaction ? null : button.dataset.reaction})); status.textContent = mine ? '已保存，再点一次可取消。' : '已取消。';}
    catch (error) {status.textContent = error.message;}
    finally {busy(false);}
  }));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const input = Object.fromEntries(new FormData(form)), draft = JSON.stringify(input);
    if (pendingComment?.draft !== draft) pendingComment = {draft, event: crypto.randomUUID()};
    busy(true); status.textContent = '正在提交…';
    try {render(await api(url, {action: 'comment', ...input, event: pendingComment.event})); form.reset(); pendingComment = null; status.textContent = '留言已发布，谢谢你的反馈。';}
    catch (error) {status.textContent = error.message;}
    finally {busy(false);}
  });
  replyForm.addEventListener('submit', async event => {
    event.preventDefault(); if (!activeTarget) return;
    const target = activeTarget, input = Object.fromEntries(new FormData(replyForm)), draft = JSON.stringify(input);
    let pending = pendingReplies.get(target.id);
    if (pending?.draft !== draft) {pending = {draft, event: crypto.randomUUID()}; pendingReplies.set(target.id, pending);}
    busy(true); replyStatus.textContent = '正在提交回复…';
    try {
      const data = await api(url, {action: 'reply', parent_id: target.id, ...input, event: pending.event});
      drafts.delete(target.id); pendingReplies.delete(target.id); activeTarget = null;
      replyForm.reset(); replyForm.hidden = true; section.append(replyForm);
      render(data); status.textContent = `已回复${target.name || '匿名同事'}。`;
    } catch (error) {replyStatus.textContent = error.message;}
    finally {busy(false);}
  });
  status.textContent = '正在读取课程反馈…'; busy(true);
  try {render(await api(url)); busy(false); status.textContent = '无需登录，欢迎点赞、拍砖、留言或回复。';}
  catch {status.textContent = '反馈暂时无法加载，稍后刷新可重试。';}
}
// Establish the shared anonymous cookie before loading the discussion widget.
await trackVisit();
await setupFeedback();
