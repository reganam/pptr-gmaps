const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const PromisePool = require("es6-promise-pool");
const { waitForNetworkIdle } = require('../utils');
const proxyChain = require('proxy-chain');

puppeteer.use(StealthPlugin());

const proxy_host = process.env.PROXY_HOST;
const proxy_port = process.env.PROXY_PORT;
const proxy_user = process.env.PROXY_USER;
const proxy_pass = process.env.PROXY_PASS;

class Scraper {
  async getHtml(searchQuery, pages) {
    let browser;

    let URLS = [];
    let results = [];
    let scrollTries = 0;
    let reachedMaxSearchResults = false;

    const defaultDelay = 300; // Increase this if running on a laggy browser or device
    let debugBool = true;
    let debug = {
      log: (...strings) => debugBool && console.log(`[${(new Date().toISOString())}]`, strings.join(" ")),
    };

    // Get the data
    async function getPageData(url) {
      const page = await browser.newPage();

      try {
        debug.log(`Opening ${url}`);
        await page.goto(url);
        await page.waitForSelector('[role="main"]').catch(movingOn);

        //Shop Name
        let shopName = (await page.$eval('[role="main"]', (element) => element.getAttribute("aria-label"))) || "No shop name provided";

        //Shop Address
        let address = await page.evaluate(() => {
          const elem = document.querySelector('button[data-item-id="address"]');
          if (elem) {
            return elem.innerText;
          } else {
            return "";
          }
        });

        //Website
        let website = await page.evaluate(() => {
          const elem = document.querySelector('[data-tooltip="Open website"]');
          if (elem) {
            return elem.innerText;
          } else {
            return "";
          }
        });

        //Phone
        const phoneElement = (await page.$x('//button[contains(@aria-label, "Phone: ")]'))[0];
        let phone = await page.evaluate((el) => {
          var result = el?.getAttribute("data-item-id")?.replace("phone:tel:", "");

          return result ? result : "";
        }, phoneElement);

        let result = {
          shop: shopName?.trim?.(),
          address: address?.trim?.(),
          website: website?.trim?.(),
          phone: phone?.trim?.(),
        };

        results.push(result);
      } catch (error) {
        debug.log(`Unable get data from ${url}`);
        debug.log(error);
      } finally {
        debug.log(`Closing ${url}`);
        await page.close();
      }
    }

    async function scrollPage(page, scrollContainer) {
      scrollTries++;

      debug.log("Starting to scroll now");

      let lastHeight = await page.evaluate(
        `document.querySelector("${scrollContainer}").scrollHeight`
      );

      while (true) {
        let scrollContainerResults = (await page.$$(`${scrollContainer} a`)).length;
        debug.log('links found:', scrollContainerResults);

        if (scrollContainerResults >= pages) {
          debug.log("Reached max search results. Stopping...");
          reachedMaxSearchResults = true;
          break;
        }

        await page.evaluate(
          `document.querySelector("${scrollContainer}").scrollTo(0, document.querySelector("${scrollContainer}").scrollHeight)`
        );

        await page.waitForTimeout(defaultDelay * 11);

        let newHeight = await page.evaluate(`document.querySelector("${scrollContainer}").scrollHeight`);
        debug.log('scrolled by', newHeight);

        if (newHeight === lastHeight) {
          break;
        }

        lastHeight = newHeight;
      }

      debug.log("finished scrolling");

      return true;
    }

    function movingOn() {
      debug.log("Wait timed out, moving on...");
    }

    function genericMovingOn() {
      debug.log("Recieved an error, attempting to move on...");
    }

    const promiseProducer = () => {
      const url = URLS.pop();

      return url ? getPageData(url) : null;
    };

    if (!searchQuery) {
      throw new Error("No param: q");
    }

    debug.log(`Search query: ${searchQuery}`);
    debug.log(`Pages count: ${pages}`);

    const launchOptions = {
      headless: process.env.PUPPETEER_HEADLESS == 1 ? true : false,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
      args: ["--disable-dev-shm-usage", "--no-sandbox"],
    };
    
    if (proxy_host || proxy_port || proxy_user || proxy_pass) {
      var proxy_url = null;
      if (proxy_user && proxy_pass) {
        proxy_url = `http://${proxy_user}:${proxy_pass}@${proxy_host}:${proxy_port}`;
      } else {
        proxy_url = `http://${proxy_host}:${proxy_port}`;
      }
    
      debug.log('Proxy configured');
    
      const currentProxyUrl = proxy_url;
      const anonymizedProxyUrl = await proxyChain.anonymizeProxy(currentProxyUrl);
    
      launchOptions["args"].push(
        `--proxy-server=${anonymizedProxyUrl}`
      );
    } else {
      debug.log('Without proxy');
    }

    browser = await puppeteer.launch(launchOptions);
    debug.log(await browser.version());

    try {
      const page = await browser.newPage();

      await page.goto("https://www.google.com/maps/?hl=en&q=" + searchQuery);

      try {
        const agree_button_xpath = "/html/body/c-wiz/div/div/div/div[2]/div[1]/div[3]/div[1]/div[1]/form[2]/div/div/button/div[3]";
        await page.waitForXPath(agree_button_xpath);
        const elements = await page.$x(agree_button_xpath);
        await elements[0].click();
      } catch (error) {
        debug.log("The button 'I agree' didn't appear.");
      }

      debug.log("Waiting for the page to load in");
      await waitForNetworkIdle(page, 600, 0);

      const scrollContainerSelector = "div[aria-label^='Results for' i]";

      while (true) {
        const noResultsFound = (await page.$x('//div[contains(text(), "Google Maps can\'t find")]'))[0];
        const endOfList = (await page.$x('//span[contains(text(), "You\'ve reached the end of the list")]'))[0];

        if (noResultsFound || endOfList || scrollTries >=5 || reachedMaxSearchResults) {
          break;
        }
        
        await scrollPage(page, scrollContainerSelector).catch(genericMovingOn);
      }
      
      URLS.push(
        ...(await page.evaluate((scrollContainerSelector) => {
          return Array.from(
            document.querySelectorAll(`${scrollContainerSelector} a`)
          )
            .map((el) => el.href)
            .filter(
              (link) =>
                link.match(/https:\/\/www.google.com\/maps\//g, link) &&
                !link.match(/\=https:\/\/www.google.com\/maps\//g, link) &&
                !link.includes(
                  "reserve"
                ) /* excludes links containing the word 'reserve' */
            );
        }, scrollContainerSelector))
      );

      URLS = Array.from(new Set(URLS));

      debug.log(JSON.stringify(URLS, null, 2));

      // How many urls we want to process in parallel.
      const CONCURRENCY = Number(process.env.CONCURRENCY) || 5;
      debug.log(`Concurrency: ${CONCURRENCY}`);

      // Runs thru all the urls in a pool of given concurrency.
      const pool = new PromisePool(promiseProducer, CONCURRENCY);
      await pool.start();

      results = results.filter(Boolean);

      // Print results.
      debug.log("Results:");
      console.log(JSON.stringify(results, null, 2));

      debug.log("Scrape complete!");

      return results;
    } finally {
      await browser.close();
    }
  }
}

module.exports = Scraper;
