<script>
	import app_image from '$lib/images/app_image.png';

	import goto_ios from '$lib/images/vendor/Download_on_the_App_Store_Badge_US-UK_RGB_blk_092917.svg';
	import goto_android from '$lib/images/vendor/google-play-badge.png';
	import goto_patreon from '$lib/images/vendor/Digital-Patreon-Logo_FieryCoral.png';
	import goto_github from '$lib/images/vendor/GitHub-Mark-120px-plus.png';
	import goto_discord from '$lib/images/vendor/icon_clyde_white_RGB.svg';

	import feature_location_sharing from '$lib/images/red_arrow_group.svg';
	import feature_doc_sync from '$lib/images/doc_sync.svg';
	import { base } from '$app/paths';

	/**
	 * Follow a URL
	 * @param {string} url
	 */
	function goto(url) {
		window.location.href = url;
	}
	export const prerender = true;
</script>

<section>
	<a class="watch_live" href="{base}/live/">Watch a group live</a>

	<div class="row" id="main_row">
		<div id="col_a">
			<h1 id="title">Welcome to xcNav</h1>
			<h2>A free and open-source paramotor app.</h2>
			<div class="row">
				<input
					type="image"
					src={goto_android}
					alt="get it on google play"
					class="goto_app"
					on:click={() => goto('https://play.google.com/store/apps/details?id=com.xcnav')}
				/>

				<input
					type="image"
					src={goto_ios}
					alt="download on the app store"
					class="goto_app"
					on:click={() => goto('https://apps.apple.com/us/app/xcnav/id1616930706')}
				/>
			</div>

			<div class="row">
				<input
					type="image"
					src={goto_patreon}
					alt="Go to Patreon"
					class="goto_resource"
					on:click={() => goto('https://www.patreon.com/xcnav')}
				/>
				<input
					type="image"
					src={goto_discord}
					alt="Go to Discord"
					class="goto_resource"
					on:click={() => goto('https://discord.gg/Zk4kp2yP')}
				/>
				<input
					type="image"
					src={goto_github}
					alt="Go to Github"
					class="goto_resource"
					on:click={() => goto('https://github.com/eidolonFIRE/xcNav')}
				/>
			</div>
		</div>

		<!-- Spacer -->
		<div id="main_spacer" />

		<img id="app_image" src={app_image} alt="app screenshot" />
	</div>

	<div style="height: 5em" />

	<h1>Features</h1>
	<div class="row" style="align-items: start">
		<div>
			<h2>Group Coordination</h2>
			<ul>
				<li>Live location sharing</li>
				<li>Syncronized flight plan</li>
				<li>Text Chat (with text-to-speech)</li>
			</ul>
		</div>

		<!-- Spacer -->
		<div id="main_spacer" />

		<div>
			<h2>Tools and Instruments</h2>
			<ul>
				<li>Audio cues</li>
				<li>ADSB-in</li>
				<li>Airspace overlay</li>
				<li>Ground elevation</li>
				<li>Advanced wind indicator</li>
				<li>Log book with in-depth stats</li>
				<li>Fuel usage calculations</li>
			</ul>
		</div>
	</div>
</section>

<style>
	ul {
		/* list-style-position: inside; */
		text-align: start;
	}

	#title {
		padding-top: 1rem;
	}

	/* Leave room for the top-left "Watch a group live" button on narrow screens */
	@media (max-width: 700px) {
		#title {
			padding-top: 4rem;
		}
	}

	#main_row {
		flex-wrap: wrap;
		justify-content: center;
		/* margin-left: 20vw;
		padding-right: 20vw; */
	}

	#main_spacer {
		width: calc(max(0px, 15vw - 10rem));
	}

	#col_a {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		/* flex: 0.8; */
		/* flex-grow: 1;
		flex-shrink: 1; */
	}

	.col {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
	}

	.row {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: center;
	}

	.goto_app {
		height: 6rem;
		flex-grow: 1;
		max-height: calc(min(4rem, 10vw));
		margin: 1rem;
	}

	.goto_resource {
		height: 5rem;
		max-height: calc(min(4rem, 10vw));
		margin: 1rem;
	}

	.watch_live {
		position: absolute;
		top: 1rem;
		left: 1rem;
		z-index: 10;
		display: inline-block;
		padding: 0.7rem 1.6rem;
		border-radius: 999px;
		background: var(--color-theme-1);
		color: #fff;
		font-size: 1.2rem;
		font-weight: bold;
		text-decoration: none;
		box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
	}

	.watch_live:hover,
	.watch_live:focus-visible {
		filter: brightness(1.08);
	}

	#app_image {
		/* display: block; */
		/* position: relative; */
		height: calc(min(40rem, 150vw));
		/* min-height: 20rem;
		max-height: 20vw; */
		border-radius: calc(min(40rem, 150vw) / 25);
		margin: 4rem;
		box-shadow: 0vh 1vh 3vh 0.5vh rgba(0, 0, 0, 0.2), 0 6px 20px 0 rgba(0, 0, 0, 0.19);
	}
</style>
