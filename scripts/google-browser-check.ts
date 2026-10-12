import {chromium,expect} from '@playwright/test';
import fs from 'node:fs/promises';
const origin='https://trashtalk-preview.berkleym.workers.dev';
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage();
 const errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error') errors.push(m.text());});
 await page.goto(origin);
 await page.getByRole('button',{name:'Account',exact:true}).click();
 const button=page.frameLocator('iframe[title="Sign in with Google Button"]').getByRole('button',{name:/Sign in with Google/});
 await expect(button).toBeVisible({timeout:20000});
 const popupPromise=page.waitForEvent('popup');
 await button.click();
 const popup=await popupPromise;
 await popup.waitForLoadState('domcontentloaded');
 await expect(popup.getByRole('textbox').first()).toBeVisible({timeout:20000});
 const report={checkedAt:new Date().toISOString(),googleButtonVisible:true,popupHost:new URL(popup.url()).hostname,accountEntryVisible:true,errors,authenticatedEndToEnd:false};
 await page.screenshot({path:'reports/google-button.png'});
 await fs.writeFile('reports/google-configuration-check.json',JSON.stringify(report,null,2));
 console.log(report);
}finally {await browser.close();}
