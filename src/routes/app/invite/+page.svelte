<script lang="ts">
  import { base } from '$app/paths';
  import { onMount } from 'svelte';
  import { publicSupabaseConfigured, supabase } from '$lib/supabase';

  let code = '';
  let email = '';
  let slug = '';
  let displayName = '';
  let isPublic = false;
  let loading = false;
  let message = '';
  let error = '';
  const slugPattern = '[a-z0-9][a-z0-9-]{1,38}[a-z0-9]';

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    code = params.get('code') ?? '';
    if (!code) error = 'Invite link is missing a code.';
  });

  function locationOrigin(): string {
    if (typeof window === 'undefined') return '';
    return window.location.origin;
  }

  function appUrl(): string {
    return `${locationOrigin()}${base}/app/`;
  }

  async function acceptInvite(): Promise<void> {
    if (!supabase || !code) return;
    loading = true;
    error = '';
    message = '';

    try {
      const { data, error: invokeError } = await supabase.functions.invoke('accept-invite', {
        body: {
          code,
          email,
          slug,
          displayName,
          isPublic
        }
      });
      if (invokeError) throw invokeError;

      const acceptedEmail = data.email ?? email;
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: acceptedEmail,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: appUrl()
        }
      });
      if (otpError) throw otpError;

      message = 'Check your email for a sign-in link.';
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      loading = false;
    }
  }
</script>

<section class="page">
  <div class="page-header">
    <span class="eyebrow">invite</span>
    <h1>Accept invite</h1>
    <p class="lede">Create your profile, then sign in from your email.</p>
  </div>

  {#if !publicSupabaseConfigured}
    <section class="panel">
      <h2>Supabase is not configured</h2>
      <p class="muted">Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_PUBLISHABLE_KEY.</p>
    </section>
  {:else}
    {#if message}<p class="notice">{message}</p>{/if}
    {#if error}<p class="error">{error}</p>{/if}

    <section class="panel invite-panel">
      <form on:submit|preventDefault={acceptInvite}>
        <label>
          email
          <input bind:value={email} type="email" autocomplete="email" required disabled={loading || Boolean(message)} />
        </label>
        <label>
          display name
          <input bind:value={displayName} required disabled={loading || Boolean(message)} />
        </label>
        <label>
          profile slug
          <input bind:value={slug} pattern={slugPattern} required disabled={loading || Boolean(message)} />
        </label>
        <label class="check-row">
          <input bind:checked={isPublic} type="checkbox" disabled={loading || Boolean(message)} />
          public profile
        </label>
        <button type="submit" disabled={loading || Boolean(message) || !code}>
          {loading ? 'accepting...' : 'accept invite'}
        </button>
      </form>
    </section>
  {/if}
</section>

<style>
  .invite-panel {
    max-width: 460px;
  }

  form {
    display: grid;
    gap: 10px;
  }

  label {
    display: grid;
    gap: 4px;
  }

  input {
    max-width: 360px;
  }

  .check-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .check-row input {
    width: auto;
  }

  .notice {
    margin-bottom: 16px;
    color: var(--muted);
  }

  .error {
    margin-bottom: 16px;
  }
</style>
