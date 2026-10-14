# AI 实践课程 Portal

独立 Portal 仓库负责目录、组装发布、共享留言/点赞与 PV/UV。课程内容由各系列仓库维护；现有 Skill Engineering 源码、PPT/PDF、练习和历史记录保留在 `zhangjian0410/skill-engineering-guide`。

主入口：https://archer-ai-courses.pages.dev/
课程入口：https://archer-ai-courses.pages.dev/courses/skill-engineering/

## 来源和构建

`src/courses.json` 登记真实课程 ID、公开仓库、分支和课程入口。构建时检出课程指定分支并记录实际 commit，调用课程自己的 build，然后复制产物到 `/courses/<id>/`。`build-info.json` 记录来源版本。Portal 不在仓库提交课程教材副本。课程的首页链接改到 `/`，共享互动脚本由 Portal 根提供；所有课程共用同源 `/api/*`。

运行 Node 22.16+、Python 3.11+：

```sh
npm run build
npm run check
npm test
```

本地可用 `COURSE_SOURCE_DIR=/absolute/course/repository` 复用课程检出；只有已构建课程才设 `SKIP_COURSE_BUILD=1`。无 override 时从登记的公开 GitHub 仓库读取，不需要跨仓库访问 Token。

Portal 的 main 变更通过 Cloudflare Git 集成发布；课程 main 变更由课程既有 Actions 检出本仓库，组装当前课程，再发布同一个 Portal 项目，之后发布旧站兼容入口。旧仓库现有部署 Secret 保留原处，不复制到源码。发布顺序防止先把旧站指向尚未上线的新站。Portal Git 构建需 Node 22、Python 3.11+，构建命令 `npm run build && npm run check && npm test`，输出 `dist`。

## 共享数据与旧网址

`wrangler.jsonc` 继续绑定既有 `ai-course-community`，没有复制数据库或清空历史。`migrations/0001` 是既有结构，`0002` 只增加短时匿名访客交接表。迁移由拥有 D1 权限的账户执行，部署 Token 仍只需 Pages Write；CI 不执行远程数据迁移。

旧课程站点的课件/Deep/自评/海报/课程目录跳转到同源的新入口。旧下载文件和资源仍可直接使用。已有浏览器匿名 Cookie 通过 120 秒、单次使用的随机交接票据延续到新站；票据只存摘要、地址不携带称呼/联系方式、跳转不缓存并禁止 Referrer，进入页面后地址清理。已有 Portal Cookie 优先，匿名标识仍不是自然人身份。

留言和称呼公开，联系方式选填并仅留在 D1；公开 GET/POST 均不返回联系方式。身份、限流、重试、明文安全显示及停止条件沿用已验证实现。多个课程按 ID 区分反馈，Portal/课程访问在同一浏览器标识下去重。后台删留言在 D1 的 comments 表操作；本版本未新增公开管理员接口。

## 新课程与回退

新增一个课程系列：准备公开课程仓库和可构建的 dist，课程需提供 index.html、deep.html、self-review.html、poster.html，首页菜单使用 href="courses.html"，共享脚本使用 src="site-interactions.js"，页面声明课程 ID 和访问类型。登记目录和真实入口，运行构建/链接/API/浏览器检查后发布。非此结构的课程需先加对应组装适配。课程修改不修改共享数据库结构；共有结构只在本仓库维护。

回退按已记录 Portal commit 和课程 commit 重新构建发布；旧站 `PORTAL_ORIGIN` 可暂时清空以恢复其静态页面；恢复旧业务后台需要回退旧站到迁移前提交。历史数据不回滚、不重置。Workers Free 和 GitHub 公开标准 runner 沿免费额度，不启用域名购买、视频或模型 API；额度耗尽可能影响互动，静态内容继续可读。

生产只自动构建 main，关闭预览分支部署，避免预览页向共享生产 D1 写入。新增课程的发布工作流也须触发 Portal 组装，不能只登记目录就宣称自动接入。

## 当前发布配置

正式 Pages 项目为 `archer-ai-courses`，连接本公开仓库；main 自动生产部署已启用，预览分支自动部署关闭。构建、同源链接检查与隔离本地 D1 测试通过后发布。共享 D1 绑定与兼容日期由 wrangler.jsonc 维护。Cloudflare 构建使用当前 Version 3 环境，满足上述最低版本；部署记录可通过 build-info.json 核对两个源码仓库的实际 commit。

## 留言回复

课件和深入阅读的每条留言可打开内嵌回复框；同一留言的回复按时间排列，较多时可展开更早回复。留言和回复仍无需登录，称呼选填并公开，联系方式选填且仅保存在 D1。匿名昵称不代表身份认证，也没有讲师身份标记。

`0003_comment_replies.sql` 只新增回复表及索引，不改原留言。回复绑定本课程的原留言；后台删除原留言会同步删除其回复。单条回复也可在 D1 的 comment_replies 表按 id 删除。公开 API 从不返回联系方式；根留言和回复共用原来的每分钟写入限额。网络重试复用提交编号，重复请求保留原内容和联系方式。

发布回复功能前须先在已有 D1 执行 0003，再推送 Portal main 自动构建发布。`npm test` 核对真实本地 D1 的回复、隐私、重试、分页、范围和级联删除；`tests/replies-browser.mjs` 只允许本机地址，验证内嵌表单、草稿、网络重试、跨课件页面、手机与更早回复。动态分页检查使用 `REPLIES_BROWSER_STATE` 指向隔离本地数据库，以及预置的 browser-root、browser-paged 和 browser-dynamic 合成案例。合成回复不得发到公网。
