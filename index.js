require('dotenv').config()

const express = require("express");
const Scraper = require("./scraper");

const port = Number(process.env.PORT || 3000);

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

app.listen(port, () => {
  console.log(`server started on port ${port}`);
});
