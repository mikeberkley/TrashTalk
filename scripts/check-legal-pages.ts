import {chromium,expect} from '@playwright/test';
import fs from 'node:fs/promises';
const origin='https://trashtalk.fanlift.ai';
const browser=await chromium.launch({channel:'chrome',headless:true});
const report:any[]=[];
try{
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:900}});
  for(const [path,title] of [['/','Sports rivalry. Made personal.'],['/privacy','Privacy Policy'],['/terms','Terms of Service']]){
   const response=await page.goto(origin+path);
   expect(response?.status()).toBe(200);
   if(path !== '/privacy') await expect(page.getByText(/\$0\.99 USD for 4 image credits/)).toBeVisible();
   await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
   await expect(page.getByRole('navigation',{name:'Footer'}).getByRole('link',{name:'Privacy Policy'})).toHaveAttribute('href','/privacy');
   await expect(page.getByRole('navigation',{name:'Footer'}).getByRole('link',{name:'Terms of Service'})).toHaveAttribute('href','/terms');
   await expect(page.getByRole('navigation',{name:'Footer'}).getByRole('link',{name:'Contact'})).toHaveAttribute('href','mailto:mike@earthly.art');
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
   expect(overflow).toBe(false);
   expect((await page.context().cookies()).length).toBe(0);
   await page.screenshot({path:`reports/legal-${path.slice(1)||'home'}-${width}.png`,fullPage:true});
   report.push({path,width,status:response?.status(),title,overflow,publicWithoutLogin:true});
  }
  await page.close();
 }
 const denied=await fetch(origin+'/api/billing/checkout',{method:'POST'});expect(denied.status).toBe(503);
 await fs.writeFile('reports/legal-pages-check.json',JSON.stringify({checkedAt:new Date().toISOString(),pages:report,checkoutBlocked:denied.status===503},null,2));
 console.log(report);
}finally{await browser.close();}
