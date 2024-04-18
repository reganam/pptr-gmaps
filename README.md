# pptr-gmaps

### Proxy configuration 

`.env` - file 

```
PROXY_HOST=
PROXY_PORT=
PROXY_USER=
PROXY_PASS=
```

If all is provided than proxy url will be:
`http://${proxy_user}:${proxy_pass}@${proxy_host}:${proxy_port}`

If only `PROXY_HOST` and `PROXY_PORT` is provided than proxy url will be:
`http://${proxy_host}:${proxy_port}`

`$env:PUPPETEER_EXECUTABLE_PATH = 'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'`

### Development

`npm install`

`npm start`

### Examples 

`http://localhost:3000/v2/?q=ziedu%20veikals%20purvciems&p=1`