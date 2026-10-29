import { defineConfig } from '@playwright/test';
const externalURL=process.env.PLAYWRIGHT_BASE_URL;
export default defineConfig({
  testDir:'./tests/browser', timeout:90000, workers:1,
  use:{baseURL:externalURL||'http://127.0.0.1:5177',headless:true,launchOptions:{args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']},viewport:{width:1440,height:1000}},
  webServer:externalURL?undefined:{command:'npm start',url:'http://127.0.0.1:5177',reuseExistingServer:true,timeout:20000},
});
