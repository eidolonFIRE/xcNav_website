<script>
	import app_image from '$lib/images/app_image.png';

	import goto_ios from '$lib/images/vendor/Download_on_the_App_Store_Badge_US-UK_RGB_blk_092917.svg';
	import goto_android from '$lib/images/vendor/google-play-badge.png';
	import goto_patreon from '$lib/images/vendor/Digital-Patreon-Logo_FieryCoral.png';
	import goto_github from '$lib/images/vendor/GitHub-Mark-120px-plus.png';
	import goto_discord from '$lib/images/vendor/icon_clyde_white_RGB.svg';

	/**
	 * Follow a URL
	 * @param {string} url
	 */
	function goto(url) {
		window.location.href = url;
	}
</script>

<section>
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
</section>

<style>
	#title {
		padding-top: 1rem;
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
