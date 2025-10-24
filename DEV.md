## Publish

```shell
# 1. auto bump version to beta
npm version prerelease --preid=beta

# 2. publish npm beta
npm publish --tag beta

# 3. test
npm install -g @tomsun28@happy-code

# 3. publish to official
npm version patch 
npm publish       
```