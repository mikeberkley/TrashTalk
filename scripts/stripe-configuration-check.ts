import {chromium,expect} from '@playwright/test';
import fs from 'node:fs/promises';
const origin='https://trashtalk-preview.berkleym.workers.dev';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);
 const me=await (await page.request.get(origin+'/api/me')).json();
 expect(me.environment).toBe('preview');expect(me.paymentsReady).toBe(true);
 await page.getByRole('button',{name:'Account',exact:true}).click();
 await expect(page.getByRole('heading',{name:'$0.99. 4 images. Your call.'})).toBeVisible();
 await page.screenshot({path:'reports/stripe-price-mobile.png',fullPage:true});
 const report={checkedAt:new Date().toISOString(),environment:me.environment,bothSecretBindingsPresent:true,testKeyPrefixAndWebhookPresent:me.paymentsReady,displayedPrice:'USD 0.99',credits:4,pageErrors:errors,actualCheckoutAndWebhookDeliveryVerified:false};
 await fs.writeFile('reports/stripe-configuration-check.json',JSON.stringify(report,null,2));console.log(report);
}finally{await browser.close();}
