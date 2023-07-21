require('dotenv').config()

const express = require("express");
const Scraper = require("./scraper");
const Scraper2 = require("./v2/scraper");

const port = Number(process.env.PORT || 3000);

console.info(`[${(new Date().toISOString())}] Browser will be running in ${(process.env.PUPPETEER_HEADLESS == 1 ? 'headless' : 'headfull')} mode`);

const app = express();

app.get("/", async (req, res) => {
  var scraper = new Scraper();
  
  var i = req.url.indexOf('?');
  var searchQuery = req.url.substr(i+3);  

  scraper
    .getHtml(searchQuery)
    .then(function (result) {
      return res.json(result);
    })
    .catch((err) => {
      console.log(err);

      return res.status(500).json(err.message);
    });
});

app.get("/v2/", async (req, res) => {
  var scraper = new Scraper2();
  
  var i = req.url.indexOf('?');
  var searchQuery = req.url.substr(i+3);

  var pages = Number(req.query.p) || 20;

  scraper
    .getHtml(searchQuery, pages)
    .then(function (result) {
      return res.json(result);
    })
    .catch((err) => {
      console.log(err);

      return res.status(500).json(err.message);
    });
});

app.listen(port, () => {
  console.log(`[${(new Date().toISOString())}] server started on port ${port}`);
});
