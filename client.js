window.__ModuleLoader__.load({
  id: '@pain-hash/dsh-cloud-sync',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useState } = React

    const DICT = {
      en: {
        section: 'Sync',
        title: 'Conversation & workspace sync',
        intro:
          'Mirror conversations and selected workspace folders into a folder your cloud drive already syncs, then run the same setup on your other computers.',
        setup: 'Cloud folder',
        folder: 'Sync folder',
        folderHint:
          'Click Browse and pick a local folder that OneDrive, Nutstore, Nextcloud or another drive keeps in sync. The folder must already exist.',
        browse: 'Browse…',
        picking: 'Choosing…',
        pickError: 'Could not open the folder picker',
        setupHint: 'Pick the cloud folder first, then press Save and Sync now.',
        device: 'This device',
        deviceHint: 'Used in conflict file names, for example laptop or office-pc.',
        auto: 'Sync automatically',
        interval: 'Interval (minutes)',
        intervalHint: '0 disables the timer; manual sync still works.',
        maxFile: 'Largest file (MB)',
        maxFileHint: 'Bigger files are skipped and listed in the sync result.',
        ignore: 'Extra ignore patterns',
        ignoreHint: 'Comma-separated globs, for example *.zip, cache/**, secret.txt',
        projects: 'Workspace folders',
        projectHint:
          'Each folder is mirrored to files/<id>. Use the same id on every computer so the two sides map to each other.',
        projectId: 'ID',
        projectPath: 'Folder',
        addProject: 'Add folder',
        remove: 'Remove',
        save: 'Save',
        saving: 'Saving…',
        syncNow: 'Sync now',
        syncing: 'Syncing…',
        saved: 'Saved',
        never: 'Not synced yet',
        lastRun: 'Last run',
        running: 'Sync in progress…',
        notConfigured: 'Choose a cloud folder to start syncing.',
        configured: 'Ready',
        summary: 'Result',
        errors: 'Problems',
        skipped: 'Skipped large files',
        loadError: 'Could not load sync status',
        saveError: 'Could not save',
        syncError: 'Sync failed',
        noProjects: 'No workspace folders yet. Conversations still sync.',
        idRequired: 'Every workspace needs an ID.',
        pathRequired: 'Every workspace needs a folder.',
      },
      zh: {
        section: '同步',
        title: '会话与工作区同步',
        intro:
          '把会话和指定的工作区目录镜像到一个已被 OneDrive、坚果云、Nextcloud 等云盘同步的本地文件夹，再在其它电脑上做同样配置即可。',
        setup: '云盘文件夹',
        folder: '同步文件夹',
        folderHint:
          '点“浏览…”选择一个已由 OneDrive、坚果云、Nextcloud 等云盘客户端同步的本地文件夹；该文件夹必须已存在。',
        browse: '浏览…',
        picking: '选择中…',
        pickError: '无法打开文件夹选择器',
        setupHint: '先选好云盘文件夹，再点“保存”和“立即同步”。',
        device: '本机名称',
        deviceHint: '用于冲突文件名，例如 laptop、office-pc。',
        auto: '自动同步',
        interval: '间隔（分钟）',
        intervalHint: '0 表示关闭定时器，仍可手动同步。',
        maxFile: '单文件上限（MB）',
        maxFileHint: '超过上限的文件会被跳过，并显示在同步结果里。',
        ignore: '额外忽略规则',
        ignoreHint: '逗号分隔的 glob，例如 *.zip, cache/**, secret.txt',
        projects: '工作区目录',
        projectHint: '每个目录镜像到 files/<ID>。两台电脑使用相同 ID 才能互相对应。',
        projectId: 'ID',
        projectPath: '目录',
        addProject: '添加目录',
        remove: '移除',
        save: '保存',
        saving: '保存中…',
        syncNow: '立即同步',
        syncing: '同步中…',
        saved: '已保存',
        never: '还没有同步过',
        lastRun: '上次同步',
        running: '正在同步…',
        notConfigured: '先选择云盘文件夹才能开始同步。',
        configured: '已就绪',
        summary: '结果',
        errors: '问题',
        skipped: '跳过的超大文件',
        loadError: '无法读取同步状态',
        saveError: '保存失败',
        syncError: '同步失败',
        noProjects: '还没有工作区目录；会话仍会同步。',
        idRequired: '每个工作区都需要 ID。',
        pathRequired: '每个工作区都需要目录。',
      },
    }

    const STYLE = `
.dsh-cloud-sync-root { max-width: 760px; padding: 4px 32px 48px; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.5; }
.dsh-cloud-sync-root h2 { margin: 0 0 6px; font-size: 20px; font-weight: 600; }
.dsh-cloud-sync-root h3 { margin: 0 0 10px; font-size: 14px; font-weight: 600; }
.dsh-cloud-sync-root p { margin: 0; }
.dsh-cloud-sync-root .muted { color: var(--dsw-alias-label-secondary); }
.dsh-cloud-sync-root .hint { color: var(--dsw-alias-label-secondary); font-size: 12px; margin-top: 4px; }
.dsh-cloud-sync-card { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); border-radius: 10px; padding: 16px 18px; margin-top: 14px; }
.dsh-cloud-sync-field { margin-top: 14px; }
.dsh-cloud-sync-field:first-child { margin-top: 0; }
.dsh-cloud-sync-label { display: block; font-weight: 600; margin-bottom: 6px; }
.dsh-cloud-sync-input { width: 100%; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); border-radius: 7px; padding: 7px 9px; font: inherit; outline: none; }
.dsh-cloud-sync-input:focus { border-color: var(--dsw-alias-brand-primary); }
.dsh-cloud-sync-inline { display: flex; gap: 14px; align-items: flex-end; flex-wrap: wrap; }
.dsh-cloud-sync-inline .dsh-cloud-sync-field { margin-top: 0; flex: 1 1 160px; }
.dsh-cloud-sync-check { display: flex; align-items: center; gap: 7px; margin-top: 14px; }
.dsh-cloud-sync-project { display: grid; grid-template-columns: 150px 1fr auto; gap: 8px; align-items: center; margin-top: 8px; }
.dsh-cloud-sync-project .dsh-cloud-sync-input { padding: 6px 8px; }
.dsh-cloud-sync-add { margin-top: 10px; }
.dsh-cloud-sync-actions { display: flex; gap: 10px; align-items: center; margin-top: 16px; flex-wrap: wrap; }
.dsh-cloud-sync-button { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border-radius: 7px; padding: 7px 14px; font: inherit; cursor: pointer; }
.dsh-cloud-sync-button:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2); }
.dsh-cloud-sync-button.primary { background: var(--dsw-alias-brand-primary); border-color: transparent; color: #fff; }
.dsh-cloud-sync-button:disabled { opacity: 0.55; cursor: default; }
.dsh-cloud-sync-link { background: none; border: 0; color: var(--dsw-alias-brand-primary); font: inherit; cursor: pointer; padding: 0 4px; }
.dsh-cloud-sync-status { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
.dsh-cloud-sync-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--dsw-alias-state-idle-primary); flex: none; }
.dsh-cloud-sync-dot.ok { background: var(--dsw-alias-state-success-primary); }
.dsh-cloud-sync-dot.warn { background: var(--dsw-alias-state-warn-primary); }
.dsh-cloud-sync-dot.bad { background: var(--dsw-alias-state-error-primary); }
.dsh-cloud-sync-error { color: var(--dsw-alias-state-error-primary); }
.dsh-cloud-sync-pre { margin: 6px 0 0; padding-left: 18px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsh-cloud-sync-meta { color: var(--dsw-alias-label-secondary); font-size: 12px; }
`

    async function callApi(pathname, init) {
      const response = await fetch(`/dsh-cloud-sync/api/${pathname}`, {
        cache: 'no-store',
        headers: init?.body ? { 'content-type': 'application/json' } : undefined,
        ...init,
      })
      let body
      try {
        body = await response.json()
      } catch {
        throw new Error(`HTTP ${response.status}`)
      }
      if (!response.ok || body.ok === false) throw new Error(body.error || `HTTP ${response.status}`)
      return body
    }

    function cloneSettings(settings) {
      return {
        ...settings,
        ignore: Array.isArray(settings.ignore) ? [...settings.ignore] : [],
        projects: Array.isArray(settings.projects) ? settings.projects.map((project) => ({ ...project })) : [],
      }
    }

    function Summary({ run, t }) {
      if (!run) return h('p', { className: 'muted' }, t('never'))
      const counts = `${t('summary')}: ${run.exported ?? 0} ↑  ${run.imported ?? 0} ↓  +${run.uploaded ?? 0}  -${run.downloaded ?? 0}  ⚠${run.conflicts ?? 0}`
      return h(
        'div',
        null,
        h('div', { className: run.ok ? 'dsh-cloud-sync-meta' : 'dsh-cloud-sync-error' }, counts),
        run.errors?.length
          ? h(
              'div',
              null,
              h('div', { className: 'dsh-cloud-sync-error', style: { marginTop: 6 } }, t('errors')),
              h('ul', { className: 'dsh-cloud-sync-pre' }, run.errors.map((error, index) => h('li', { key: index }, error))),
            )
          : null,
        run.skippedLarge?.length
          ? h(
              'div',
              null,
              h('div', { className: 'muted', style: { marginTop: 6 } }, t('skipped')),
              h('ul', { className: 'dsh-cloud-sync-pre' }, run.skippedLarge.map((file, index) => h('li', { key: index }, file))),
            )
          : null,
      )
    }

    function Page({ t, locale }) {
      const [status, setStatus] = useState(null)
      const [draft, setDraft] = useState(null)
      const [busy, setBusy] = useState('')
      const [picking, setPicking] = useState(false)
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [, setLocaleTick] = useState(0)

      useEffect(() => locale.subscribe(() => setLocaleTick((tick) => tick + 1)), [locale])

      useEffect(() => {
        let live = true
        callApi('status')
          .then((body) => {
            if (!live) return
            setStatus(body.status)
            setDraft((current) => current ?? cloneSettings(body.status.settings))
          })
          .catch((failure) => live && setError(`${t('loadError')}: ${failure.message}`))
        return () => {
          live = false
        }
      }, [])

      useEffect(() => {
        const tick = setInterval(() => {
          callApi('status')
            .then((body) => setStatus(body.status))
            .catch(() => {})
        }, 15_000)
        return () => clearInterval(tick)
      }, [])

      const lastRun = status?.lastRun
      const running = busy === 'sync' || status?.running === true
      const configured = Boolean(status?.configured)

      function update(patch) {
        setDraft((current) => ({ ...current, ...patch }))
        setNotice('')
      }

      function updateProject(index, patch) {
        setDraft((current) => ({
          ...current,
          projects: current.projects.map((project, at) => (at === index ? { ...project, ...patch } : project)),
        }))
        setNotice('')
      }

      function addProject() {
        setDraft((current) => ({
          ...current,
          projects: [...current.projects, { id: '', path: '', title: '' }],
        }))
        setNotice('')
      }

      function removeProject(index) {
        setDraft((current) => ({
          ...current,
          projects: current.projects.filter((_, at) => at !== index),
        }))
        setNotice('')
      }

      async function browse() {
        setPicking(true)
        setError('')
        setNotice('')
        try {
          const body = await callApi('action', {
            method: 'POST',
            body: JSON.stringify({ action: 'pick' }),
          })
          if (typeof body.path === 'string' && body.path !== '') update({ syncRoot: body.path })
        } catch (failure) {
          setError(`${t('pickError')}: ${failure.message}`)
        } finally {
          setPicking(false)
        }
      }

      async function save() {
        setBusy('save')
        setError('')
        setNotice('')
        try {
          const settings = {
            ...draft,
            ignore: String(draft.ignoreText ?? (draft.ignore ?? []).join(', '))
              .split(',')
              .map((entry) => entry.trim())
              .filter(Boolean),
            projects: draft.projects
              .filter((project) => project.path.trim() !== '' || project.id.trim() !== '')
              .map((project) => ({
                id: project.id.trim(),
                path: project.path.trim(),
                title: project.title?.trim() ?? '',
              })),
          }
          delete settings.ignoreText
          for (const project of settings.projects) {
            if (project.id === '') throw new Error(t('idRequired'))
            if (project.path === '') throw new Error(t('pathRequired'))
          }
          const body = await callApi('action', {
            method: 'POST',
            body: JSON.stringify({ action: 'save', settings }),
          })
          setStatus(body.status)
          setDraft(cloneSettings(body.status.settings))
          setNotice(t('saved'))
        } catch (failure) {
          setError(`${t('saveError')}: ${failure.message}`)
        } finally {
          setBusy('')
        }
      }

      async function syncNow() {
        setBusy('sync')
        setError('')
        setNotice('')
        try {
          const body = await callApi('action', {
            method: 'POST',
            body: JSON.stringify({ action: 'sync' }),
          })
          setStatus(body.status)
        } catch (failure) {
          setError(`${t('syncError')}: ${failure.message}`)
        } finally {
          setBusy('')
        }
      }

      if (draft === null) {
        return h('div', { className: 'dsh-cloud-sync-root' }, h('p', { className: 'muted' }, error || '…'))
      }

      const ignoreText = draft.ignoreText ?? (draft.ignore ?? []).join(', ')
      const dotClass = !configured ? 'warn' : lastRun?.ok === false ? 'bad' : lastRun ? 'ok' : ''

      return h(
        'div',
        { className: 'dsh-cloud-sync-root' },
        h('style', null, STYLE),
        h('h2', null, t('title')),
        h('p', { className: 'muted' }, t('intro')),
        h('p', { className: 'muted', style: { marginTop: 4 } }, t('setupHint')),
        h(
          'div',
          { className: 'dsh-cloud-sync-status' },
          h('span', { className: `dsh-cloud-sync-dot ${dotClass}` }),
          h('span', { className: 'muted' }, configured ? (running ? t('running') : t('configured')) : t('notConfigured')),
        ),
        error ? h('p', { className: 'dsh-cloud-sync-error', style: { marginTop: 8 } }, error) : null,
        notice ? h('p', { className: 'muted', style: { marginTop: 8 } }, notice) : null,

        h(
          'section',
          { className: 'dsh-cloud-sync-card' },
          h('h3', null, t('setup')),
          h(
            'div',
            { className: 'dsh-cloud-sync-field' },
            h('label', { className: 'dsh-cloud-sync-label' }, t('folder')),
            h(
              'div',
              { style: { display: 'flex', gap: 8, alignItems: 'center' } },
              h('input', {
                className: 'dsh-cloud-sync-input',
                value: draft.syncRoot,
                placeholder: 'D:\\Cloud\\dsh-cloud-sync',
                onChange: (event) => update({ syncRoot: event.target.value }),
              }),
              h(
                'button',
                {
                  className: 'dsh-cloud-sync-button',
                  type: 'button',
                  disabled: picking,
                  style: { flex: 'none' },
                  onClick: browse,
                },
                picking ? t('picking') : t('browse'),
              ),
            ),
            h('p', { className: 'hint' }, t('folderHint')),
          ),
          h(
            'div',
            { className: 'dsh-cloud-sync-field' },
            h('label', { className: 'dsh-cloud-sync-label' }, t('device')),
            h('input', {
              className: 'dsh-cloud-sync-input',
              value: draft.deviceName,
              onChange: (event) => update({ deviceName: event.target.value }),
            }),
            h('p', { className: 'hint' }, t('deviceHint')),
          ),
          h(
            'div',
            { className: 'dsh-cloud-sync-inline' },
            h(
              'div',
              { className: 'dsh-cloud-sync-field' },
              h('label', { className: 'dsh-cloud-sync-label' }, t('interval')),
              h('input', {
                className: 'dsh-cloud-sync-input',
                type: 'number',
                min: 0,
                max: 1440,
                value: draft.intervalMinutes,
                onChange: (event) => update({ intervalMinutes: Number(event.target.value) }),
              }),
              h('p', { className: 'hint' }, t('intervalHint')),
            ),
            h(
              'div',
              { className: 'dsh-cloud-sync-field' },
              h('label', { className: 'dsh-cloud-sync-label' }, t('maxFile')),
              h('input', {
                className: 'dsh-cloud-sync-input',
                type: 'number',
                min: 1,
                max: 2048,
                value: draft.maxFileMB,
                onChange: (event) => update({ maxFileMB: Number(event.target.value) }),
              }),
              h('p', { className: 'hint' }, t('maxFileHint')),
            ),
          ),
          h('label', { className: 'dsh-cloud-sync-check' },
            h('input', {
              type: 'checkbox',
              checked: draft.autoSync !== false,
              onChange: (event) => update({ autoSync: event.target.checked }),
            }),
            h('span', null, t('auto')),
          ),
          h(
            'div',
            { className: 'dsh-cloud-sync-field' },
            h('label', { className: 'dsh-cloud-sync-label' }, t('ignore')),
            h('input', {
              className: 'dsh-cloud-sync-input',
              value: ignoreText,
              onChange: (event) => update({ ignoreText: event.target.value }),
            }),
            h('p', { className: 'hint' }, t('ignoreHint')),
          ),
        ),

        h(
          'section',
          { className: 'dsh-cloud-sync-card' },
          h('h3', null, t('projects')),
          h('p', { className: 'hint', style: { marginTop: 0, marginBottom: 8 } }, t('projectHint')),
          draft.projects.length === 0 ? h('p', { className: 'muted' }, t('noProjects')) : null,
          draft.projects.map((project, index) =>
            h(
              'div',
              { className: 'dsh-cloud-sync-project', key: index },
              h('input', {
                className: 'dsh-cloud-sync-input',
                value: project.id,
                placeholder: t('projectId'),
                onChange: (event) => updateProject(index, { id: event.target.value }),
              }),
              h('input', {
                className: 'dsh-cloud-sync-input',
                value: project.path,
                placeholder: t('projectPath'),
                onChange: (event) => updateProject(index, { path: event.target.value }),
              }),
              h('button', { className: 'dsh-cloud-sync-link', type: 'button', onClick: () => removeProject(index) }, t('remove')),
            ),
          ),
          h('button', { className: 'dsh-cloud-sync-button dsh-cloud-sync-add', type: 'button', onClick: addProject }, t('addProject')),
        ),

        h(
          'div',
          { className: 'dsh-cloud-sync-actions' },
          h('button', { className: 'dsh-cloud-sync-button primary', type: 'button', disabled: busy !== '', onClick: save }, busy === 'save' ? t('saving') : t('save')),
          h('button', { className: 'dsh-cloud-sync-button', type: 'button', disabled: busy !== '' || !configured, onClick: syncNow }, busy === 'sync' ? t('syncing') : t('syncNow')),
          h('span', { className: 'dsh-cloud-sync-meta' }, lastRun?.finishedAt ? `${t('lastRun')}: ${new Date(lastRun.finishedAt).toLocaleString()}` : t('never')),
        ),
        h(Summary, { run: lastRun, t }),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.locale.register('dsh-cloud-sync', DICT)
        const t = ctx.locale.bind('dsh-cloud-sync')
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'dsh-cloud-sync',
              order: 25,
              label: () => t('section'),
            },
            function SyncSection() {
              return h(Page, { t, locale: ctx.locale })
            },
          ),
        )
      },
    }
  },
})
