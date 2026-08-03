// 跨平台测试入口：ts-node 默认会向上查找到根 tsconfig.json（面向客户端/ESM），
// 这里显式指定服务端/测试用的 CommonJS 配置，再加载测试文件。
// node:test 会自动运行通过 test() 注册的用例，因此无需 --test 参数即可执行。
process.env.TS_NODE_PROJECT = require('path').join(__dirname, '..', 'tsconfig.test.json');
require('ts-node/register');
require('../src/tests/crossPreview.test.ts');
require('../src/tests/previewReadonly.test.ts');
require('../src/tests/sharedRules.test.ts');
require('../src/tests/previewCancellation.test.ts');
