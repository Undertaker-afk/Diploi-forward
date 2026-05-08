instantuse
forward
exposing
env var 
DIPLOI_AI_TOKEN
DIPLOI_AI_API_BASE_URL

sincetheseareintenalnetworkapiurlsnotaccessablefromoutsidenetwrokweneedanappthatrunsonbunotsowhereicanjustinputthegithubrepothenitparsesthediploi.yamlanddeploysaprogrammthatforwardstheopenaiandanthropicapis
sincetheygiveeveryonefreeunlimited
theinternalnetworkurlis:
http://core.diploi/ai-core-proxy/v1

sobuildanallinonefreeaiservicethatexposestheseapistotheinternet

https://diploi.com/yaml



hereistheircontnueaiconfig
name: Diploi AI Model Configuration
version: 1.0.1
schema: v1
models:
  - name: GPT-5.3-Codex
    provider: openai
    model: gpt-5.3-codex
    apiKey: '${{ secrets.DIPLOI_AI_TOKEN }}'
    apiBase: '${{ secrets.DIPLOI_AI_API_BASE_URL }}'
    roles:
      - chat
      - edit
      - apply
    capabilities:
      - tool_use
    defaultCompletionOptions:
      contextLength: 400000
      maxTokens: 128000
    default: true

  - name: Claude Sonnet 4.6
    provider: anthropic
    model: claude-sonnet-4-6
    apiKey: '${{ secrets.DIPLOI_AI_TOKEN }}'
    apiBase: '${{ secrets.DIPLOI_AI_API_BASE_URL }}'
    roles:
      - chat
      - edit
      - apply
    defaultCompletionOptions:
      contextLength: 500000
      maxTokens: 64000
      promptCaching: true
    capabilities:
      - tool_use
      - image_input
    thinking:
      enabled: false

context:
  - provider: code
  - provider: file
  - provider: currentFile
  - provider: diff
  - provider: problems
  - provider: repo-map
    params:
      includeSignatures: false
  - provider: http
    name: Diploi Documentation
    params:
      url: 'https://docs.diploi.com/llms-full.txt'
