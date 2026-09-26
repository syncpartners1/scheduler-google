import { BOT_COMMANDS } from '../telegram-commands.js'

const token = process.env.TELEGRAM_BOT_TOKEN
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required')
async function setCommands(commands, scope) {
  const res = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commands, ...(scope ? { scope } : {}) }),
  })
  const data = await res.json()
  if (!res.ok || !data.ok) throw new Error(`setMyCommands failed: ${JSON.stringify(data)}`)
}
await setCommands(BOT_COMMANDS)
if (process.env.ADMIN_TELEGRAM_ID) {
  await setCommands([
    ...BOT_COMMANDS,
    { command: 'users', description: 'מאמן: רשימת משתמשים' },
    { command: 'report', description: 'מאמן: דוח משתתף' },
    { command: 'invite', description: 'מאמן: יצירת הזמנה' },
    { command: 'broadcast', description: 'מאמן: הודעה למשתתפים' },
  ], { type: 'chat', chat_id: Number(process.env.ADMIN_TELEGRAM_ID) })
}
console.log('Telegram command menu registered')
