const { Curl } = require('node-libcurl')
const Caseless = require('caseless')
const url = require('url')

function parseSafeStringify(data) {
  try {
    return JSON.stringify(data)
  } catch (error) {
    return data
  }
}

function parseSafeJson(data) {
  try {
    return JSON.parse(data)
  } catch (error) {
    return data
  }
}

function parseXmlToJson(data) {
  try {
    const json = {}
    for (const xml of data.matchAll(/(?:<(\w*)(?:\s[^>]*)*>)((?:(?!<\1).)*)(?:<\/\1>)|<(\w*)(?:\s*)*\/>/gm)) {
      const key = xml[1] || xml[3]
      const value = xml[2] && parseXmlToJson(xml[2])
      json[key] = ((value && Object.keys(value).length) ? value : xml[2]) || null

    }
    return json
  } catch (error) {
    return data
  }
}

class Request {
  constructor(options) {
    return this.init(options)
  }

  async init(options) {
    if (options.url) {
      options.uri = options.url
      delete options.url
    }

    if (options.qs) {
      const parsed = url.parse(options.uri)

      options.uri += !parsed.search ? `?` : parsed.search == '?' ? '' : '&'

      const values = []
      for (let key in options.qs) {
        values.push(`${key}=${options.qs[key]}`)
      }

      options.uri += values.join('&')
    }

    return new Promise(async (resolve, reject) => {
      const curl = new Curl()

      curl.setOpt('URL', options.uri)

      if (options.verbose) {
        curl.setOpt(Curl.option.VERBOSE, true)
        curl.setOpt(Curl.option.DEBUGFUNCTION, (infoType, content) => {
          if (infoType == 0) {
            console.log(Buffer.from(content).toString().trim())
          }
        })
      }

      if (options.strictSSL) {
        curl.setOpt(Curl.option.CAINFO, './cacert.pem')
      } else {
        curl.setOpt(Curl.option.SSL_VERIFYPEER, false)
        curl.setOpt(Curl.option.SSL_VERIFYHOST, false)
        curl.setOpt(Curl.option.SSL_VERIFYSTATUS, false)
      }

      curl.setOpt(Curl.option.CUSTOMREQUEST, options.method || 'GET')

      curl.setOpt(Curl.option.SSL_ENABLE_ALPN, false)
      curl.setOpt(Curl.option.SSL_ENABLE_NPN, false)

      if (options.gzip) {
        curl.setOpt(Curl.option.ACCEPT_ENCODING, '')
      } else {
        curl.setOpt(Curl.option.HTTP_CONTENT_DECODING, '0')
      }

      if (options.timeout) {
        curl.setOpt(Curl.option.TIMEOUT_MS, options.timeout)
      }

      if (options.forever) {
        curl.setOpt(Curl.option.TCP_KEEPALIVE, 2)
        curl.setOpt(Curl.option.FORBID_REUSE, 0)
        curl.setOpt(Curl.option.FRESH_CONNECT, 0)
      } else {
        curl.setOpt(Curl.option.TCP_KEEPALIVE, 0)
        curl.setOpt(Curl.option.FORBID_REUSE, 2)
        curl.setOpt(Curl.option.FRESH_CONNECT, 1)
      }

      curl.setOpt(Curl.option.PATH_AS_IS, options.rebuild)

      if (options.form) {
        const data = []
        const keys = Object.keys(options.form)

        for (let i in keys) {
          const key = keys[i]
          data.push(`${key}=${options.form[key]}`)
        }

        const fields = data.join('&')
        curl.setOpt(Curl.option.POSTFIELDS, fields)

        const caseless = Caseless(options.headers)

        if (options.headers) {
          if (!caseless.get('content-type')) {
            caseless.set('content-type', 'application/x-www-form-urlencoded')
          }
        } else {
          options.headers = {
            'content-type': 'application/x-www-form-urlencoded',
          }
        }
      } else if (options.body) {
        const caseless = Caseless(options.headers)
        if (options.headers) {
          if (!caseless.get('content-type')) {
            caseless.set('content-type', 'application/x-www-form-urlencoded')
          }
        } else {
          options.headers = {
            'content-type': 'application/x-www-form-urlencoded',
          }
        }

        curl.setOpt(Curl.option.POSTFIELDS, options.body)
      } else if (options.json) {
        const caseless = Caseless(options.headers)
        if (options.headers) {
          if (!caseless.get('content-type')) {
            caseless.set('content-type', 'application/json')
          }
        } else {
          options.headers = {
            'content-type': 'application/json',
          }
        }

        curl.setOpt(Curl.option.POSTFIELDS, parseSafeStringify(options.json))
      }

      if (options.http2) {
        curl.setOpt(Curl.option.SSL_ENABLE_ALPN, true)
        curl.setOpt(Curl.option.HTTP_VERSION, 'CURL_HTTP_VERSION_2_0')
      } else {
        curl.setOpt(Curl.option.HTTP_VERSION, 'CURL_HTTP_VERSION_1_1')
      }

      const headers = []
      let hasCookieHeader = false

      if (typeof options.headers === 'object') {
        for (const header in options.headers) {
          if (header.toLowerCase() == 'cookie') {
            if (options.jar) {
              const cookiesInJar = options.jar.getCookieStringSync(options.uri)
              if (!cookiesInJar) {
                headers.push(`${header}: ${options.headers[header]}`)
              } else {
                headers.push(`${header}: ${options.headers[header]}; ${cookiesInJar}`)
              }
            } else {
              headers.push(`${header}: ${options.headers[header]}`)
            }

            hasCookieHeader = true
          } else {
            headers.push(`${header}: ${options.headers[header]}`)
          }
        }
      }

      if (!hasCookieHeader && options.jar) {
        const cookiesInJar = options.jar.getCookieStringSync(options.uri)
        headers.push(`cookie: ${cookiesInJar}`)
      }

      curl.setOpt(Curl.option.HTTPHEADER, headers)

      if (options.proxy) {
        curl.setOpt(Curl.option.PROXY, options.proxy)
      }

      curl.setOpt(Curl.option.FOLLOWLOCATION, false)

      if (options.ciphers) {
        curl.setOpt(Curl.option.SSL_CIPHER_LIST, options.ciphers)
      }

      curl.on('end', async function (statusCode, data, headers) {
        const respHeaders = headers[headers.length - 1]
        delete respHeaders.result

        if (options.jar) {
          const parsedUrl = url.parse(options.uri)
          const host = `${parsedUrl.protocol}//${parsedUrl.host}/`

          const caseless = Caseless(respHeaders)

          if (caseless.get('set-cookie')) {
            caseless.get('set-cookie').forEach(function (c) {
              const cookie = c.split(';')[0]
              options.jar.setCookieSync(cookie, host)
            })
          }
        }

        if (options.followRedirects && curl.getInfo(Curl.info.REDIRECT_URL)) {
          options.redirectCount = options.redirectCount + 1 || 1
          if (options.redirectCount != options.maxRedirects) {
            options.forever = true
            options.uri = curl.getInfo(Curl.info.REDIRECT_URL)

            options.method = options.followMethod || options.method || 'GET'
            if (options.method.toLowerCase() == 'get') {
              delete options.form
              delete options.body
            }

            this.close()
            return resolve(new Request(options))
          }
        }

        if (options.json) {
          data = parseSafeJson(data)
        }

        if (options.xml) {
          data = parseXmlToJson(data)
        }

        let response = {
          body: data,
          headers: respHeaders,
          statusCode: statusCode,
        }

        this.close()

        resolve(response)
      })

      curl.on('error', function (error) {
        curl.close.bind(curl)
        this.close()
        reject({ error: error.message })
      })

      try {
        curl.perform()
      } catch (error) {
        curl.close()
        reject({ error: error.message })
      }
    })
  }
}

module.exports = Request
