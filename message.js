const https = require('https');
const fs = require('fs');
const { URL } = require('url');
const { HttpProxyAgent } = require('http-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');
const UserAgent = require('user-agents');

class CookieAuth {
    // Set your proxy here or via environment variable PROXY
    static proxyUrl = process.env.PROXY || null;
    
    static getRandomUserAgent() {
        return new UserAgent().toString();
    }
    
    static setProxy(proxyUrl) {
        // Ensure proxy URL has http:// protocol for the agent
        if (proxyUrl && !proxyUrl.startsWith('http')) {
            proxyUrl = 'http://' + proxyUrl;
        }
        CookieAuth.proxyUrl = proxyUrl;
        const displayUrl = proxyUrl ? proxyUrl.split('@')[1] : 'None';
        console.log(`[CookieAuth] Proxy set to: ${displayUrl}`);
    }
    static parseCookies(fileContent) {
        const cookies = {};
        const lines = fileContent.split('\n');
        
        for (const line of lines) {
            const trimmed = line.trim();
            
            // Skip empty lines and comments
            if (!trimmed || trimmed.startsWith('#')) continue;
            
            // Split by tab
            const parts = trimmed.split('\t');
            if (parts.length < 7) continue;
            
            const domain = parts[0].toLowerCase();
            const name = parts[5].trim();
            const value = parts.length > 6 ? parts[6].trim() : '';
            
            // Filter for Microsoft cookies
            if (!domain.includes('login.live.com') && 
                domain !== '.live.com' && 
                domain !== 'login.live.com' && 
                domain !== '.account.microsoft.com') {
                continue;
            }
            
            // Skip disabled or empty cookies
            if (value === 'Disabled' || value === '') {
                continue;
            }
            
            // Skip if already have this cookie
            if (cookies[name]) continue;
            
            cookies[name] = value;
        }
        
        return cookies;
    }
    
    static buildCookieHeader(cookies, useJSH = false) {
        const cookieOrder = useJSH ? 
            ['JSH', 'MSPAuth', 'MSPBack', 'MSPProf', 'MSPRequ', 'MSPSoftVis', 'NAP', 'OParams', 'PPLState', 'WLSSC'] :
            ['JSHP', 'MSPAuth', 'MSPBack', 'MSPProf', 'MSPRequ', 'MSPSoftVis', 'NAP', 'OParams', 'PPLState', 'WLSSC'];
        
        // Add extra cookies
        const extraCookies = Object.keys(cookies).filter(name => 
            !cookieOrder.includes(name) && 
            (name === '__Host-MSAAUTH' || name.startsWith('__Host-') || name === 'uaid')
        );
        
        const allCookies = [...cookieOrder, ...extraCookies];
        const cookieParts = [];
        
        for (const name of allCookies) {
            if (cookies[name]) {
                cookieParts.push(`${name}=${cookies[name]}`);
            }
        }
        
        return cookieParts.join('; ');
    }
    
    static httpsRequest(urlStr, options = {}) {
        return new Promise((resolve, reject) => {
            const url = new URL(urlStr);
            const requestOptions = {
                hostname: url.hostname,
                port: 443,
                path: url.pathname + url.search,
                method: options.method || 'GET',
                headers: options.headers || {}
            };
            
            // Add proxy agent if proxy is configured
            if (CookieAuth.proxyUrl) {
                requestOptions.agent = new HttpsProxyAgent(CookieAuth.proxyUrl);
            }
            
            const req = https.request(requestOptions, (res) => {
                let data = '';
                
                res.on('data', chunk => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        body: data
                    });
                });
            });
            
            req.on('error', reject);
            
            if (options.body) {
                req.write(options.body);
            }
            
            req.end();
        });
    }
    
    static async getAccessTokenFromCookie(cookies, useJSH = false) {
        const cookieHeader = CookieAuth.buildCookieHeader(cookies, useJSH);
        const oauthUrl = 'https://login.live.com/oauth20_authorize.srf?redirect_uri=https://sisu.xboxlive.com/connect/oauth/XboxLive&response_type=token&client_id=000000004420578E&scope=XboxLive.Signin%20XboxLive.offline_access';
        
        const response = await CookieAuth.httpsRequest(oauthUrl, {
            method: 'GET',
            headers: {
                'Host': 'login.live.com',
                'User-Agent': CookieAuth.getRandomUserAgent(),
                'Cookie': cookieHeader,
                'Accept-Encoding': 'gzip',
                'Connection': 'keep-alive',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });
        
        if (response.statusCode === 302 && response.headers.location && response.headers.location.includes('#access_token=')) {
            const location = response.headers.location;
            const fragment = location.split('#')[1];
            const params = {};
            
            fragment.split('&').forEach(param => {
                if (param.includes('=')) {
                    const [key, value] = param.split('=', 2);
                    params[key] = decodeURIComponent(value);
                }
            });
            
            if (params.access_token) {
                return params.access_token;
            }
        }
        
        return null;
    }

    static async getRefreshTokenFromCookie(cookies, useJSH = false) {
        const cookieHeader = CookieAuth.buildCookieHeader(cookies, useJSH);
        
        // Use Microsoft Application Auth client ID (from Java code or similar)
        const clientId = '42a60a84-599d-44b2-a7c6-b00cdef1d6a2';
        const redirectUri = 'http://localhost:25575/callback';
        
        // First attempt: Try WITH user interaction (remove prompt=none)
        let authUrl = `https://login.live.com/oauth20_authorize.srf?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=XboxLive.signin%20XboxLive.offline_access&state=state123`;
        
        console.log('[CookieAuth] Attempting refresh token acquisition (allowing user interaction)...');
        
        let authResponse = await CookieAuth.httpsRequest(authUrl, {
            method: 'GET',
            headers: {
                'Host': 'login.live.com',
                'User-Agent': CookieAuth.getRandomUserAgent(),
                'Cookie': cookieHeader,
                'Accept-Encoding': 'gzip',
                'Connection': 'keep-alive',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });
        
        console.log(`[CookieAuth] Auth response status: ${authResponse.statusCode}`);
        if (authResponse.statusCode !== 200 && authResponse.statusCode !== 302) {
            console.log(`[CookieAuth] Unexpected status, body: ${authResponse.body.substring(0, 200)}`);
        }
        
        let authCode = null;
        
        if (authResponse.statusCode === 302 && authResponse.headers.location) {
            const location = authResponse.headers.location;
            console.log(`[CookieAuth] Redirect to: ${location.substring(0, 150)}`);
            
            if (location.includes('code=')) {
                const urlParams = new URL(location, 'http://localhost').searchParams;
                authCode = urlParams.get('code');
                console.log(`[CookieAuth] Got authorization code!`);
            } else if (location.includes('error=')) {
                const urlParams = new URL(location, 'http://localhost').searchParams;
                const error = urlParams.get('error');
                const errorDesc = urlParams.get('error_description');
                console.log(`[CookieAuth] Microsoft error: ${error}`);
                
                // If consent is required, this is expected - we can't get refresh token without user interaction
                if (error === 'consent_required' || error === 'interaction_required') {
                    console.log('[CookieAuth] Consent required - cannot obtain refresh token without user interaction');
                    return null;
                }
            } else {
                console.log(`[CookieAuth] Redirect has no code or error`);
            }
        } else if (authResponse.statusCode === 200) {
            // Sometimes Microsoft returns 200 with HTML instead of redirect
            console.log('[CookieAuth] Got 200 response, checking for auth code in body...');
            if (authResponse.body.includes('code=')) {
                const match = authResponse.body.match(/code=([^&"']+)/);
                if (match) {
                    authCode = match[1];
                    console.log('[CookieAuth] Extracted code from response body');
                }
            }
        } else if (authResponse.statusCode === 417) {
            console.log('[CookieAuth] 417 Proxy error - skipping');
            return null;
        }
        
        if (!authCode) {
            console.log('[CookieAuth] Failed to obtain authorization code');
            return null;
        }
        
        // Exchange the authorization code for tokens
        const body = `client_id=${clientId}&grant_type=authorization_code&code=${authCode}&redirect_uri=${encodeURIComponent(redirectUri)}`;
        
        console.log('[CookieAuth] Exchanging authorization code for tokens...');
        
        const tokenResponse = await CookieAuth.httpsRequest('https://login.live.com/oauth20_token.srf', {
            method: 'POST',
            headers: {
                'Host': 'login.live.com',
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': CookieAuth.getRandomUserAgent(),
                'Accept': 'application/json',
                'Accept-Language': 'en-US,en;q=0.9'
            },
            body: body
        });
        
        console.log(`[CookieAuth] Token exchange status: ${tokenResponse.statusCode}`);
        
        if (tokenResponse.statusCode === 200) {
            try {
                const tokenData = JSON.parse(tokenResponse.body);
                console.log(`[CookieAuth] Token response has: ${Object.keys(tokenData).join(', ')}`);
                
                if (tokenData.refresh_token) {
                    console.log('[CookieAuth] ✓ Successfully obtained refresh token');
                    return tokenData.refresh_token;
                } else {
                    console.log('[CookieAuth] No refresh_token in response');
                    console.log('[CookieAuth] Full response:', JSON.stringify(tokenData, null, 2).substring(0, 300));
                }
            } catch (e) {
                console.log('[CookieAuth] Failed to parse token response:', e.message);
            }
        } else {
            console.log(`[CookieAuth] Token endpoint error: ${tokenResponse.statusCode}`);
            console.log('[CookieAuth] Response:', tokenResponse.body.substring(0, 300));
        }
        
        return null;
    }
    
    static async authenticateWithCookies(cookies) {
        console.log('[CookieAuth] Starting authentication process...');
        
        const hasJSHP = cookies.hasOwnProperty('JSHP');
        const hasJSH = cookies.hasOwnProperty('JSH');
        let accessToken = null;
        
        if (hasJSHP) {
            console.log('[CookieAuth] Trying authentication with JSHP...');
            try {
                accessToken = await CookieAuth.getAccessTokenFromCookie(cookies, false);
            } catch (e) {
                console.error('[CookieAuth] JSHP attempt failed:', e.message);
            }
        }
        
        if (!accessToken && hasJSH) {
            console.log('[CookieAuth] Trying authentication with JSH...');
            try {
                accessToken = await CookieAuth.getAccessTokenFromCookie(cookies, true);
            } catch (e) {
                console.error('[CookieAuth] JSH attempt failed:', e.message);
            }
        }
        
        if (!accessToken) {
            console.log('[CookieAuth] Failed to get access token');
            return false;
        }
        
        console.log('[CookieAuth] Authenticating with Xbox Live...');
        
        const xboxPayload = {
            Properties: {
                AuthMethod: 'RPS',
                SiteName: 'user.auth.xboxlive.com',
                RpsTicket: `d=${accessToken}`
            },
            RelyingParty: 'http://auth.xboxlive.com',
            TokenType: 'JWT'
        };
        
        const xboxResponse = await CookieAuth.httpsRequest('https://user.auth.xboxlive.com/user/authenticate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': CookieAuth.getRandomUserAgent(),
                'X-Xbl-Contract-Version': '0'
            },
            body: JSON.stringify(xboxPayload)
        });
        
        if (xboxResponse.statusCode !== 200) {
            console.log('[CookieAuth] Xbox Live authentication failed');
            return false;
        }
        
        const xboxData = JSON.parse(xboxResponse.body);
        const xboxToken = xboxData.Token;
        const uhs = xboxData.DisplayClaims.xui[0].uhs;
        
        console.log('[CookieAuth] Getting XSTS token...');
        
        const xstsPayload = {
            Properties: {
                SandboxId: 'RETAIL',
                UserTokens: [xboxToken]
            },
            RelyingParty: 'rp://api.minecraftservices.com/',
            TokenType: 'JWT'
        };
        
        const xstsResponse = await CookieAuth.httpsRequest('https://xsts.auth.xboxlive.com/xsts/authorize', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': CookieAuth.getRandomUserAgent(),
                'X-Xbl-Contract-Version': '0'
            },
            body: JSON.stringify(xstsPayload)
        });
        
        if (xstsResponse.statusCode !== 200) {
            console.log('[CookieAuth] XSTS authentication failed');
            return false;
        }
        
        const xstsData = JSON.parse(xstsResponse.body);
        const xstsToken = xstsData.Token;
        const xblToken = `XBL3.0 x=${uhs};${xstsToken}`;
        
        console.log('[CookieAuth] Authenticating with Minecraft...');
        
        const mcResponse = await CookieAuth.postMinecraftLogin(xblToken);
        
        if (!mcResponse || !mcResponse.access_token) {
            console.log('[CookieAuth] Failed to get Minecraft access token');
            return false;
        }
        
        console.log('[CookieAuth] Retrieving Minecraft profile...');
        
        const profileResponse = await CookieAuth.getMinecraftProfile(mcResponse.access_token);
        
        if (!profileResponse || !profileResponse.name) {
            console.log('[CookieAuth] Failed to get Minecraft profile');
            return false;
        }
        
        console.log(`[CookieAuth] Successfully logged in as ${profileResponse.name}`);
        
        // Attempt to get refresh token from cookies
        console.log('[CookieAuth] Attempting to get Microsoft refresh token...');
        let refreshToken = undefined;
        
        if (hasJSHP) {
            try {
                refreshToken = await CookieAuth.getRefreshTokenFromCookie(cookies, false);
            } catch (e) {
                console.error('[CookieAuth] Failed to get refresh token with JSHP:', e.message);
            }
        }
        
        if (!refreshToken && hasJSH) {
            try {
                refreshToken = await CookieAuth.getRefreshTokenFromCookie(cookies, true);
            } catch (e) {
                console.error('[CookieAuth] Failed to get refresh token with JSH:', e.message);
            }
        }
        
        if (refreshToken) {
            console.log('[CookieAuth] Successfully obtained refresh token');
        } else {
            console.log('[CookieAuth] Warning: Could not obtain refresh token');
        }
        
        return {
            username: profileResponse.name,
            uuid: profileResponse.id,
            accessToken: mcResponse.access_token,
            refreshToken: refreshToken
        };
    }
    
    static async postMinecraftLogin(xblToken) {
        const payload = JSON.stringify({
            identityToken: xblToken,
            ensureLegacyEnabled: true
        });
        
        const response = await CookieAuth.httpsRequest('https://api.minecraftservices.com/authentication/login_with_xbox', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: payload
        });
        
        if (response.statusCode !== 200) {
            throw new Error(`HTTP error code: ${response.statusCode}, Response: ${response.body}`);
        }
        
        return JSON.parse(response.body);
    }
    
    static async getMinecraftProfile(accessToken) {
        const response = await CookieAuth.httpsRequest('https://api.minecraftservices.com/minecraft/profile', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json'
            }
        });
        
        if (response.statusCode !== 200) {
            throw new Error(`HTTP error code: ${response.statusCode}, Response: ${response.body}`);
        }
        
        return JSON.parse(response.body);
    }

    static async refreshMicrosoftAccessToken(refreshToken) {
        console.log('[CookieAuth] Attempting to refresh Microsoft access token...');
        
        const clientId = '42a60a84-599d-44b2-a7c6-b00cdef1d6a2';
        const redirectUri = 'http://localhost:25575/callback';
        
        const body = `client_id=${clientId}&grant_type=refresh_token&refresh_token=${refreshToken}&redirect_uri=${encodeURIComponent(redirectUri)}`;
        
        const response = await CookieAuth.httpsRequest('https://login.live.com/oauth20_token.srf', {
            method: 'POST',
            headers: {
                'Host': 'login.live.com',
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': CookieAuth.getRandomUserAgent(),
                'Accept': 'application/json',
                'Accept-Language': 'en-US,en;q=0.9'
            },
            body: body
        });
        
        if (response.statusCode === 200) {
            try {
                const tokenData = JSON.parse(response.body);
                if (tokenData.access_token) {
                    console.log('[CookieAuth] Successfully refreshed Microsoft access token');
                    return {
                        access_token: tokenData.access_token,
                        refresh_token: tokenData.refresh_token || refreshToken,
                        expires_in: tokenData.expires_in
                    };
                }
            } catch (e) {
                console.error('[CookieAuth] Failed to parse refresh token response:', e.message);
            }
        } else {
            console.error(`[CookieAuth] Refresh failed with status ${response.statusCode}`);
        }
        
        return null;
    }

    static async refreshMinecraftAccessToken(microsoftAccessToken) {
        console.log('[CookieAuth] Attempting to refresh Minecraft access token...');
        
        try {
            // First get Xbox token
            const xboxPayload = {
                Properties: {
                    AuthMethod: 'RPS',
                    SiteName: 'user.auth.xboxlive.com',
                    RpsTicket: `d=${microsoftAccessToken}`
                },
                RelyingParty: 'http://auth.xboxlive.com',
                TokenType: 'JWT'
            };
            
            const xboxResponse = await CookieAuth.httpsRequest('https://user.auth.xboxlive.com/user/authenticate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': CookieAuth.getRandomUserAgent(),
                    'X-Xbl-Contract-Version': '0'
                },
                body: JSON.stringify(xboxPayload)
            });
            
            if (xboxResponse.statusCode !== 200) {
                console.error('[CookieAuth] Xbox Live refresh failed');
                return null;
            }
            
            const xboxData = JSON.parse(xboxResponse.body);
            const xboxToken = xboxData.Token;
            const uhs = xboxData.DisplayClaims.xui[0].uhs;
            
            // Get XSTS token
            const xstsPayload = {
                Properties: {
                    SandboxId: 'RETAIL',
                    UserTokens: [xboxToken]
                },
                RelyingParty: 'rp://api.minecraftservices.com/',
                TokenType: 'JWT'
            };
            
            const xstsResponse = await CookieAuth.httpsRequest('https://xsts.auth.xboxlive.com/xsts/authorize', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': CookieAuth.getRandomUserAgent(),
                    'X-Xbl-Contract-Version': '0'
                },
                body: JSON.stringify(xstsPayload)
            });
            
            if (xstsResponse.statusCode !== 200) {
                console.error('[CookieAuth] XSTS refresh failed');
                return null;
            }
            
            const xstsData = JSON.parse(xstsResponse.body);
            const xstsToken = xstsData.Token;
            const xblToken = `XBL3.0 x=${uhs};${xstsToken}`;
            
            // Get new Minecraft token
            const mcResponse = await CookieAuth.postMinecraftLogin(xblToken);
            
            if (mcResponse && mcResponse.access_token) {
                console.log('[CookieAuth] Successfully refreshed Minecraft access token');
                return mcResponse.access_token;
            }
            
            return null;
        } catch (e) {
            console.error('[CookieAuth] Error refreshing Minecraft token:', e.message);
            return null;
        }
    }
    
    static async addAccountFromCookieFile(cookieFilePath) {
        try {
            const fileContent = fs.readFileSync(cookieFilePath, 'utf8');
            console.log('[CookieAuth] Reading cookie file...');
            
            const cookies = CookieAuth.parseCookies(fileContent);
            
            if (Object.keys(cookies).length === 0) {
                console.log('[CookieAuth] No valid Microsoft cookies found');
                return false;
            }
            
            console.log('[CookieAuth] Building cookie string...');
            const result = await CookieAuth.authenticateWithCookies(cookies);
            
            return result;
        } catch (e) {
            console.error('[CookieAuth] Error processing cookie file:', e);
            return false;
        }
    }
}

module.exports = CookieAuth;
