(async () => {
    const DEFAULT_SLEEP = [400, 450];


    const {Logger, Time, BG, Net, Image, NopeCHA} = await import(chrome.runtime.getURL('utils.js'));


    function is_widget_frame() {
        return document.querySelector('div.check') !== null;
    }


    function is_image_frame() {
        return document.querySelector('h2.prompt-text') !== null;
    }


    function open_image_frame() {
        document.querySelector('#checkbox')?.click();
    }


    function is_solved() {
        const is_widget_frame_solved = document.querySelector('div.check')?.style['display'] === 'block';
        return is_widget_frame_solved;
    }


    function get_image_url($e) {
        const matches = $e?.style['background']?.trim()?.match(/(?!^)".*?"/g);
        if (!matches || matches.length === 0) {
            return null;
        }
        return matches[0].replaceAll('"', '');
    }


    function get_lang() {
        let lang = document.querySelector('.display-language .text').innerText || window.navigator.userLanguage || window.navigator.language;
        if (!lang) {
            return null;
        }
        lang = lang.toLowerCase();
        lang = lang.split('-')[0];
        return lang;
    }


    async function get_task() {
        let task = document.querySelector('h2.prompt-text')?.innerText?.replace(/\s+/g, ' ')?.trim();
        if (!task) {
            console.log('error getting task', task);
            return null;
        }

        const CODE = {
            '0430': 'a',
            '0441': 'c',
            '0501': 'd',
            '0435': 'e',
            '04bb': 'h',
            '0456': 'i',
            '0458': 'j',
            '04cf': 'l',
            '03bf': 'o',
            '043e': 'o',
            '0440': 'p',
            '0455': 's',
            '0445': 'x',
            '0443': 'y',

            '03bf': 'o',
            '04bb': 'h',
            '0065': 'e',
            '0069': 'i',
            '0430': 'a',
            '0435': 'e',
            '0440': 'p',
            '0441': 'c',
            '0443': 'y',
            '0455': 's',
            '0456': 'i',
            '0501': 'd',
            '30fc': '一',
            '571f': '士',
        };

        function pad_left(s, char, n) {
            while (`${s}`.length < n) {
                s = `${char}${s}`;
            }
            return s;
        }

        const new_task = [];
        for (const e of task) {
            const k = pad_left(e.charCodeAt(0).toString(16), '0', 4);
            if (k in CODE) {
                new_task.push(CODE[k]);
            }
            else {
                new_task.push(e);
            }
        }
        task = new_task.join('');

        const lang = get_lang();
        if (lang && lang !== 'en') {
            task = await BG.exec('translate', {from: lang, to: 'en', text: task});
        }

        return task;
    }


    let last_urls_hash = null;
    function on_task_ready(i=100) {
        return new Promise(resolve => {
            let checking = false;
            const check_interval = setInterval(async () => {
                if (checking) {
                    return;
                }
                checking = true;

                // let task = document.querySelector('h2.prompt-text')?.innerText?.replace('Please click each image containing', '')?.trim();
                // const task = document.querySelector('h2.prompt-text')?.innerText.trim();
                // let task = document.querySelector('h2.prompt-text')?.innerText?.replace(/\s+/g, ' ')?.trim();
                let task = await get_task();
                if (!task) {
                    checking = false;
                    return;
                }
                console.log('task', task);

                const $task_image = document.querySelector('.challenge-example > .image > .image');
                const task_url = get_image_url($task_image);
                if (!task_url || task_url === '') {
                    console.log('no task image url', $task_image);
                    checking = false;
                    return;
                }

                const $cells = document.querySelectorAll('.task-image');
                if ($cells.length !== 9) {
                    console.log('invalid number of cells', $cells);
                    checking = false;
                    return;
                }

                const cells = [];
                const urls = [];
                for (const $e of $cells) {
                    const $img = $e.querySelector('div.image');
                    if (!$img) {
                        console.log('no cell image', $e);
                        checking = false;
                        return;
                    }

                    const url = get_image_url($img);
                    if (!url || url === '') {
                        console.log('no cell image url', $e);
                        checking = false;
                        return;
                    }

                    cells.push($e);
                    urls.push(url);
                }

                const urls_hash = JSON.stringify(urls);
                if (last_urls_hash === urls_hash) {
                    console.log('task unchanged');
                    checking = false;
                    return;
                }
                last_urls_hash = urls_hash;

                clearInterval(check_interval);
                checking = false;
                return resolve({task, task_url, cells, urls});
            }, i);
        });
    }


    function got_solve_incorrect() {
        const $error = document.querySelector('.display-error');
        return $error?.getAttribute('aria-hidden') !== 'true';
    }


    function submit() {
        try {
            document.querySelector('.button-submit').click();
        } catch (e) {
            console.log('error submitting', e);
        }
    }


    function is_cell_selected($cell) {
        return $cell.getAttribute('aria-pressed') === 'true';
    }


    async function log_stat() {
        if (!Logger.debug) {
            return;
        }

        let n_success = await BG.exec('get_cache', {name: 'hcaptcha_pass'});
        let n_fail = await BG.exec('get_cache', {name: 'hcaptcha_fail'});
        if (n_success === null) {
            n_success = 0;
        }
        if (n_fail === null) {
            n_fail = 0;
        }
        let success_rate = 0;
        if (n_success + n_fail > 0) {
            success_rate = Math.round((100 * n_success) / (n_success + n_fail));
        }
        // Logger.log(`success_rate: ${success_rate}%`);
        // Logger.log(`success: ${n_success}`);
        // Logger.log(`fail: ${n_fail}`);
    }


    async function inc_pass() {
        await BG.exec('inc_cache', {name: 'hcaptcha_pass'});
        await log_stat();
    }


    async function inc_fail() {
        await BG.exec('inc_cache', {name: 'hcaptcha_fail'});
        await log_stat();
    }


    async function on_widget_frame(settings) {
        // Wait if already solved
        if (is_solved()) {
            if (!was_solved) {
                await inc_pass();
                was_solved = true;
            }
            // Refresh page to collect samples
            if (settings.debug) {
                window.location.reload();
            }
            return;
        }
        was_solved = false;
        await Time.sleep(settings.hcaptcha_open_delay);
        open_image_frame();
    }


    async function on_image_frame(settings) {
        // Failed stat
        if (!was_incorrect && got_solve_incorrect()) {
            await inc_fail();
            was_incorrect = true;
            // // window.location.reload();
            // document.querySelector('.refresh')?.click();
            // await Time.sleep(500);
        }
        else {
            was_incorrect = false;
        }

        const {task, task_url, cells, urls} = await on_task_ready();
        const task_image = await Image.encode(task_url);

        // Convert image url to blob
        const images = [];
        for (const url of urls) {
            images.push(await Image.encode(url));
        }

        // await Time.sleep(settings.solve_delay);
        const solve_start = Time.time();

        // Detect images
        const captcha_type = 'hcaptcha';
        const key = settings.key;
        // const {job_id, clicks} = await solve({key, task, task_image, images});
        const {job_id, clicks} = await NopeCHA.post({captcha_type, task, task_image, images, key});
        if (!clicks) {
            return;
        }

        const delta = settings.hcaptcha_solve_delay - (Time.time() - solve_start);
        if (delta > 0) {
            await Time.sleep(delta);
        }

        await Time.random_sleep(...DEFAULT_SLEEP);

        // Solve
        for (let i = 0; i < clicks.length; i++) {
            if (clicks[i] === false) {
                continue;
            }

            // Click if not already selected
            if (!is_cell_selected(cells[i])) {
                cells[i].click();
            }
        }

        await Time.random_sleep(...DEFAULT_SLEEP);

        submit();
    }


    let was_solved = false;
    let was_incorrect = false;


    while (true) {
        await Time.sleep(1000);

        const settings = await BG.exec('get_settings');
        if (!settings) {
            continue;
        }
        Logger.debug = settings.debug;

        if (settings.hcaptcha_auto_open && is_widget_frame()) {
            await on_widget_frame(settings);
        }
        else if (settings.hcaptcha_auto_solve && is_image_frame()) {
            await on_image_frame(settings);
        }
    }
})();