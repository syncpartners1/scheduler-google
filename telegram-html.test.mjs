import assert from 'node:assert/strict'
import { telegramHtml, sendBridgeHtml } from './telegram-html.js'

assert.equal(telegramHtml('בוא נגדיר <b>היעד האסטרטגי</b> הראשון'), 'בוא נגדיר <b>היעד האסטרטגי</b> הראשון')
// AICOACH markdown_to_html() escapes literal tags from the model once.
assert.equal(telegramHtml('בוא נגדיר &lt;b&gt;היעד האסטרטגי&lt;/b&gt; הראשון'), 'בוא נגדיר <b>היעד האסטרטגי</b> הראשון')
assert.equal(telegramHtml('&lt;script&gt;alert(1)&lt;/script&gt;'), '&lt;script&gt;alert(1)&lt;/script&gt;')
assert.equal(telegramHtml('&lt;a href="javascript:alert(1)"&gt;no&lt;/a&gt;'), '&lt;a href="javascript:alert(1)"&gt;no')
assert.equal(telegramHtml('A & B <b>bold'), 'A &amp; B <b>bold</b>')
assert.equal(telegramHtml('A &amp; B <script>x</script>'), 'A &amp; B &lt;script&gt;x&lt;/script&gt;')
assert.equal(telegramHtml('<b>one <i>two</b> three</i>'), '<b>one <i>two</i></b> three')
assert.equal(telegramHtml('<a href="javascript:alert(1)">bad</a>'), '&lt;a href="javascript:alert(1)"&gt;bad')
assert.equal(telegramHtml('<a href="https://example.com?a=1&amp;b=2">safe</a>'), '<a href="https://example.com/?a=1&amp;b=2">safe</a>')
assert.equal(telegramHtml('line<br>two'), 'line\ntwo')
assert.equal(telegramHtml('<pre>x<b>y</b></pre>'), '<pre>xy</pre>')
let calls=[]
await sendBridgeHtml({reply: async (...args) => {calls.push(args); return true}}, 'היי <b>שלום</b>')
assert.deepEqual(calls, [['היי <b>שלום</b>', {parse_mode:'HTML'}]])
calls=[]
await sendBridgeHtml({reply: async (...args) => {calls.push(args); if(calls.length===1) throw {description:"Bad Request: can't parse entities"}; return true}}, 'היי <b>שלום</b>')
assert.equal(calls[1][0], 'היי שלום')
console.log('html tests passed')
