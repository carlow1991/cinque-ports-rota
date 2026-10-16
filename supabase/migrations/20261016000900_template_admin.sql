-- Phase 3: admin editing of template duties. One atomic call updates an item and its included
-- responsibilities together. Changing a template never touches events already created from it.

create function public.admin_update_template_item(
  p_item_id uuid, p_required_count int, p_enabled_by_default boolean,
  p_start_anchor public.template_time_anchor, p_start_offset int,
  p_end_anchor public.template_time_anchor, p_end_offset int,
  p_suppressed boolean, p_signup_enabled boolean, p_approval_required boolean,
  p_when_to_enable text, p_instructions text, p_responsibilities text[]
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := public._require_caller(); v_item public.duty_template_items%rowtype; v_primary text;
begin
  if not public.is_admin() then perform public._fail('not_authorised', 'Only an administrator can change templates.'); end if;
  select * into v_item from public.duty_template_items where id = p_item_id for update;
  if not found then perform public._fail('not_found', 'Template duty not found.'); end if;
  if p_required_count is null or p_required_count < 1 or p_required_count > 50 then
    perform public._fail('invalid_headcount', 'Each duty needs between 1 and 50 volunteers.');
  end if;
  if abs(coalesce(p_start_offset, 0)) > 1440 or abs(coalesce(p_end_offset, 0)) > 1440 then
    perform public._fail('invalid_times', 'Offsets must be within 24 hours of the event.');
  end if;
  select code into v_primary from public.duty_types where id = v_item.duty_type_id;
  if v_primary = any (coalesce(p_responsibilities, '{}')) then
    perform public._fail('responsibility_is_primary', 'An included duty cannot repeat the main duty.');
  end if;
  update public.duty_template_items set
    required_count = p_required_count, enabled_by_default = coalesce(p_enabled_by_default, true),
    start_anchor = p_start_anchor, start_offset_minutes = coalesce(p_start_offset, 0),
    end_anchor = p_end_anchor, end_offset_minutes = coalesce(p_end_offset, 0),
    suppressed_by_linked_cover = coalesce(p_suppressed, false), signup_enabled = coalesce(p_signup_enabled, true),
    approval_required = coalesce(p_approval_required, false),
    when_to_enable = nullif(btrim(left(p_when_to_enable, 500)), ''), instructions = nullif(btrim(left(p_instructions, 2000)), '')
  where id = p_item_id;
  delete from public.template_item_responsibilities where template_item_id = p_item_id;
  insert into public.template_item_responsibilities (template_item_id, duty_type_id)
  select p_item_id, id from public.duty_types where code = any (coalesce(p_responsibilities, '{}'));
  return jsonb_build_object('item_id', p_item_id);
end;
$$;

create function public.admin_add_template_item(p_template_id uuid, p_duty_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := public._require_caller(); v_id uuid;
begin
  if not public.is_admin() then perform public._fail('not_authorised', 'Only an administrator can change templates.'); end if;
  insert into public.duty_template_items (template_id, duty_type_id, sort_order, enabled_by_default)
  values (p_template_id, (select id from public.duty_types where code = p_duty_code and active),
          coalesce((select max(sort_order) from public.duty_template_items where template_id = p_template_id), 0) + 10, false)
  returning id into v_id;
  return jsonb_build_object('item_id', v_id);
end;
$$;

grant execute on function
  public.admin_update_template_item(uuid, int, boolean, public.template_time_anchor, int, public.template_time_anchor, int,
                                    boolean, boolean, boolean, text, text, text[]),
  public.admin_add_template_item(uuid, text)
to authenticated;
