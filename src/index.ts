import { getOctokit } from '@actions/github'
import { setFailed, setOutput } from '@actions/core'

import { release, upload, GitHubReleaser } from './github'
import { paths, parseConfig, isTag, unmatchedPatterns, uploadUrl } from './util'

import { env } from 'process'

async function run() {
  try {
    const config = parseConfig(env)

    if (!config.input_tag_name && !isTag(config.github_ref) && !config.input_draft) {
      throw new Error(`⚠️ GitHub Releases requires a tag`)
    }

    if (config.input_files) {
      const patterns = unmatchedPatterns(config.input_files)
      patterns.forEach((pattern) =>
        console.warn(`🤔 Pattern '${pattern}' does not match any files.`)
      )

      if (patterns.length > 0 && config.input_fail_on_unmatched_files) {
        throw new Error(`⚠️ There were unmatched files`)
      }
    }

    const gh = getOctokit(config.github_token, {
      throttle: {
        onRateLimit: (retryAfter, options) => {
          console.warn(`Request quota exhausted for request ${options.method} ${options.url}`)

          if (options.request.retryCount === 0) {
            console.log(`Retrying after ${retryAfter} seconds!`)

            return true
          }
        },
        onAbuseLimit: (retryAfter, options) => {
          console.warn(`Abuse detected for request ${options.method} ${options.url}`)
        },
      },
    })

    const rel = await release(config, new GitHubReleaser(gh))

    if (config.input_files) {
      const files = paths(config.input_files)

      if (files.length == 0) {
        console.warn(`🤔 ${config.input_files} not include valid file.`)
      }

      const assets = await Promise.all(
        files.map(async (path) => {
          const json = await upload(config, gh, uploadUrl(rel.upload_url), path, rel.assets)

          delete json.uploader

          return json
        })
      ).catch((error: Error) => {
        throw error
      })
      setOutput('assets', assets)
    }

    console.log(`🎉 Release ready at ${rel.html_url}`)

    setOutput('url', rel.html_url)
    setOutput('id', rel.id.toString())
    setOutput('upload_url', rel.upload_url)
  } catch (error) {
    setFailed(error instanceof Error ? error.message : String(error))
  }
}

run()
