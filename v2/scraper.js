const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const PromisePool = require("es6-promise-pool");

puppeteer.use(StealthPlugin());

const launchOptions = {
  headless: process.env.PUPPETEER_HEADLESS == 1 ? true : false,
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
  args: ["--disable-dev-shm-usage", "--no-sandbox"],
};

if (process.env.PROXY_HOST && process.env.PROXY_PORT) {
  launchOptions["args"].push(
    `--proxy-server=${process.env.PROXY_HOST}:${process.env.PROXY_PORT}`
  );
}

class Scraper {
  async getHtml(searchQuery) {
    let browser;

    // How many urls we want to process in parallel.
    const CONCURRENCY = Number(process.env.CONCURRENCY) || 5;
    console.info(`Concurrency: ${CONCURRENCY}`);

    let URLS = [];
    let results = [];
    let scrollTries = 0;

    const defaultDelay = 300; // Increase this if running on a laggy browser or device
    let debugBool = true;
    let debug = {
      log: (...strings) => debugBool && console.log(strings.join(" ")),
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
        console.log(`Unable get data from ${url}`);
        console.log(error);
      } finally {
        debug.log(`Closing ${url}`);
        await page.close();
      }
    }

    async function scrollPage(page, scrollContainer) {
      scrollTries++;
      debug.log("Waiting for the page to load in");
      await page.waitForTimeout(defaultDelay * 11);

      debug.log("Starting to scroll now");

      let lastHeight = await page.evaluate(
        `document.querySelector("${scrollContainer}").scrollHeight`
      );

      while (true) {
        await page.evaluate(
          `document.querySelector("${scrollContainer}").scrollTo(0, document.querySelector("${scrollContainer}").scrollHeight)`
        );

        await page.waitForTimeout(defaultDelay * 11);

        let newHeight = await page.evaluate(
          `document.querySelector("${scrollContainer}").scrollHeight`
        );

        if (newHeight === lastHeight) {
          break;
        }

        lastHeight = newHeight;
      }

      debug.log("finished scrolling");

      // Get results
      const searchResults = await page.evaluate(() =>
        Array.from(document.querySelectorAll("a"))
          .map((el) => el.href)
          .filter(
            (link) =>
              link.match(/https:\/\/www.google.com\/maps\//g, link) &&
              !link.match(/\=https:\/\/www.google.com\/maps\//g, link)
          )
      );
      
      debug.log("I got", searchResults.length, "results");

      return searchResults;
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

    console.log(`Search query: ${searchQuery}`);

    browser = await puppeteer.launch(launchOptions);
    console.log(await browser.version());

    try {
      const page = await browser.newPage();

      if (process.env.PROXY_USER && process.env.PROXY_PASS) {
        await page.authenticate({
          username: process.env.PROXY_USER,
          password: process.env.PROXY_PASS,
        });
      }

      await page.goto("https://www.google.com/maps/?hl=en&q=" + searchQuery);

      try {
        //const agree_button_xpath = '//button/span[.="I agree"]';
        const agree_button_xpath = "/html/body/c-wiz/div/div/div/div[2]/div[1]/div[3]/div[1]/div[1]/form[2]/div/div/button/div[3]";
        await page.waitForXPath(agree_button_xpath);
        const elements = await page.$x(agree_button_xpath);
        await elements[0].click();

        await page.waitForNavigation({ waitUntil: "domcontentloaded" });

        //await page.waitForTimeout(defaultDelay * 10);
      } catch (error) {
        console.log("The button 'I agree' didn't appear.");
      }

      while (true) {
        const noResultsFound = (await page.$x('//div[contains(text(), "Google Maps can\'t find")]'))[0];
        const endOfList = (await page.$x('//span[contains(text(), "You\'ve reached the end of the list")]'))[0];

        if (noResultsFound || endOfList || scrollTries >=5) break;

        // If it hasn't go to the next page
        URLS.push(...(await scrollPage(page, "div[aria-label^='Results for' i]").catch(genericMovingOn)));
      }

      URLS = Array.from(new Set(URLS));

      console.log(URLS);

      // Runs thru all the urls in a pool of given concurrency.
      const pool = new PromisePool(promiseProducer, CONCURRENCY);
      await pool.start();

      results = results.filter(Boolean);

      // Print results.
      console.log("Results:");
      console.log(JSON.stringify(results, null, 2));

      debug.log("Scrape complete!");

      return results;
    } finally {
      await browser.close();
    }
  }
}

module.exports = Scraper;
