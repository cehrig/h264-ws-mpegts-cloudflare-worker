module.exports = class SlackLogger{
    constructor(slackurl) {
        this.url = slackurl;
    }

    async write(msg)
    {
        let slack_url, slack_request, slack_response;

        if (this.url === '') {
            return;
        }

        if (typeof msg !== 'string') {
            msg = JSON.stringify(msg);
        }

        slack_url = new URL(this.url);
        slack_request = new Request(slack_url, {
            method: 'POST',
            headers: {
                'content-type': 'application/json'
            },
            body: `{"text":"${msg}"}`
        });

        // Doing two retries here
        for (let i = 0; i < 3; i++) {
            slack_response = await fetch(slack_request);

            if (slack_response.status !== 200) {
                await new Promise((rs, rj) => setTimeout(rs, (i+1) * 1000));
            } else {
                return true;
            }
        }

        if (slack_response.status !== 200) {
            return false;
        }

        return true;
    }
}